---
'@geekmidas/cli': minor
---

`gkm compose:server --zsh` and `--oh-my-zsh` give the admin a zsh login shell

`--zsh` installs zsh and makes it the admin's login shell. `--oh-my-zsh` does
the same and clones Oh My Zsh into the admin's home, starting a `.zshrc` from
its template; an existing `.zshrc` is kept and named if it does not load Oh My
Zsh. Running it again changes nothing. The deploy user's shell is untouched.
