/**
 * What `gkm compose:server` runs on the server, as root (through the admin
 * user's sudo). Plain bash, so `--dry-run` can print exactly what will run,
 * and safe to run again: every step changes only what is missing or wrong.
 *
 * Arguments, in order: the admin user (the one running sudo), the deploy
 * user, the SSH port, the deploy key's public line, and its comment.
 *
 * The last line it prints is `HOSTKEY=<fingerprint>` — the server's own
 * ed25519 host key, which the command checks the network's against before
 * pinning it for CI.
 */
export const SERVER_SCRIPT = String.raw`set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
ADMIN="$1"; DEPLOY="$2"; SSH_PORT="$3"; PUB="$4"; COMMENT="$5"
say() { echo "   $*"; }
fail() { echo "   ✗ $*" >&2; exit 1; }

. /etc/os-release
case "$ID" in
	ubuntu | debian) ;;
	*) fail "gkm sets up Ubuntu and Debian servers; this one is $ID." ;;
esac

# ── SSH: keys only, no root ────────────────────────────────────────────────
# Before password logins are turned off, the admin must have a key to come
# back with — otherwise this would lock them out.
ADMIN_HOME="$(getent passwd "$ADMIN" | cut -d: -f6)"
[ -s "$ADMIN_HOME/.ssh/authorized_keys" ] ||
	fail "$ADMIN has no key in $ADMIN_HOME/.ssh/authorized_keys; turning off password logins would lock them out."
# First match wins in sshd_config, and 00- sorts before what a provider ships
# (cloud-init's 50-cloud-init.conf turns password logins back on).
cat > /etc/ssh/sshd_config.d/00-gkm-hardening.conf <<'EOF'
# Written by gkm compose:server.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
# The deploy migrates through an SSH tunnel to the server's loopback.
cat > /etc/ssh/sshd_config.d/60-gkm-deploy.conf <<EOF
# Written by gkm compose:server.
Match User $DEPLOY
    AllowTcpForwarding local
EOF
sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd
# What sshd actually does now, whatever else is in its config.
EFFECTIVE="$(sshd -T)"
for setting in 'permitrootlogin no' 'passwordauthentication no' 'kbdinteractiveauthentication no'; do
	grep -qx "$setting" <<<"$EFFECTIVE" || fail "sshd still does not say '$setting'; another file in /etc/ssh overrides it."
done
FORWARD="$(sshd -T -C "user=$DEPLOY,host=localhost,addr=127.0.0.1" | sed -n 's/^allowtcpforwarding //p')"
case "$FORWARD" in
	yes | all | local) ;;
	*) fail "sshd does not let $DEPLOY forward ports (allowtcpforwarding $FORWARD)." ;;
esac
say "sshd: keys only, no root login; $DEPLOY may open local tunnels"
# Root is reached through the admin's sudo, which this script is running
# under — so its password, the one a provider mails out, can go.
passwd -l root >/dev/null
say "root's password locked; $ADMIN's sudo is the way to root"

# ── Firewall: SSH, HTTP, HTTPS ─────────────────────────────────────────────
command -v ufw >/dev/null || { apt-get update -qq && apt-get install -y -qq ufw >/dev/null; }
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "$SSH_PORT/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
say "firewall: $SSH_PORT, 80, 443 in; everything out"
EXTRA="$(ufw status | awk 'NR > 4 && $1 != "" { print $1 }' | grep -vxE "(($SSH_PORT|80|443)(/tcp)?|OpenSSH)" | sort -u || true)"
if [ -n "$EXTRA" ]; then
	say "⚠ also open: $(echo $EXTRA). gkm uses none of them; close each with: sudo ufw delete allow <port>"
fi

# ── Updates and bans ───────────────────────────────────────────────────────
apt-get update -qq
apt-get install -y -qq unattended-upgrades fail2ban >/dev/null
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/fail2ban/jail.d/gkm.local <<EOF
# Written by gkm compose:server.
[sshd]
enabled = true
port = $SSH_PORT
EOF
systemctl enable --now unattended-upgrades fail2ban >/dev/null 2>&1
systemctl restart fail2ban
say "security updates install daily; fail2ban watches sshd"

# ── Docker, from Docker's own repository ───────────────────────────────────
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
	say "installing Docker…"
	apt-get install -y -qq ca-certificates curl >/dev/null
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
	chmod a+r /etc/apt/keyrings/docker.asc
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
		> /etc/apt/sources.list.d/docker.list
	apt-get update -qq
	apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1
say "docker $(docker version --format '{{.Server.Version}}')"

# ── The deploy user: no password, no sudo, in the docker group ─────────────
id "$DEPLOY" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY" >/dev/null
usermod -aG docker "$DEPLOY"
DEPLOY_HOME="$(getent passwd "$DEPLOY" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY" -g "$DEPLOY" "$DEPLOY_HOME/.ssh"
AUTH="$DEPLOY_HOME/.ssh/authorized_keys"
touch "$AUTH"
# One managed line: this key (or an earlier one by the same name) replaced,
# with nothing allowed but the commands and the tunnel the deploy uses.
KEYBODY="$(awk '{ print $2 }' <<<"$PUB")"
grep -v -F -e "$KEYBODY" -e " $COMMENT" "$AUTH" > "$AUTH.new" || true
echo "restrict,port-forwarding $PUB" >> "$AUTH.new"
mv "$AUTH.new" "$AUTH"
chown "$DEPLOY:$DEPLOY" "$AUTH"
chmod 600 "$AUTH"
say "user $DEPLOY (docker group), deploy key authorized with restrict,port-forwarding"
OTHERS="$(grep -v -F -e "$KEYBODY" "$AUTH" | grep -c . || true)"
if [ "$OTHERS" -gt 0 ]; then
	say "⚠ $AUTH holds $OTHERS other key(s). Review: sudo cat $AUTH"
fi

echo "HOSTKEY=$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{ print $2 }')"
`;

/**
 * What runs as root to give a fresh server its admin — the guide's first
 * step, for a server only root can log in to yet: a sudo user, with root's
 * keys so the same key logs in. `adduser` asks for its password, which sudo
 * will ask for.
 */
export const ADMIN_SCRIPT = `set -euo pipefail
ADMIN="$1"
if ! id "$ADMIN" >/dev/null 2>&1; then
	echo "   creating $ADMIN — choose the password sudo will ask for:"
	adduser --gecos "" "$ADMIN"
fi
usermod -aG sudo "$ADMIN"
HOME_DIR="$(getent passwd "$ADMIN" | cut -d: -f6)"
install -d -m 700 -o "$ADMIN" -g "$ADMIN" "$HOME_DIR/.ssh"
AUTH="$HOME_DIR/.ssh/authorized_keys"
touch "$AUTH"
# The keys alone: a provider's options on root's lines (a command="…" that
# says "log in as ubuntu") would stop the admin's login too. A server root
# logs in to with a password has none; ssh-copy-id brings the admin's.
{ grep -oE '(ssh|ecdsa|sk)-[^ ]+ [A-Za-z0-9+/=]+( .*)?$' /root/.ssh/authorized_keys 2>/dev/null || true; } |
	while IFS= read -r key; do
		grep -qxF "$key" "$AUTH" || echo "$key" >> "$AUTH"
	done
chown "$ADMIN:$ADMIN" "$AUTH"
chmod 600 "$AUTH"
echo "   $ADMIN is a sudo user, with root's SSH keys (if root had any)"
`;
