---
'@geekmidas/cli': patch
---

`GKM_EDGE_PROJECT` renames the shared Traefik edge — its compose project, and with it its Docker network and its volumes (`<project>_acme`, `_certs`, `_dynamic`). The default stays `gkm-edge`. It is a testing and advanced knob: the local-stage-on-Traefik end-to-end suite now runs an edge of its own (`gkm-edge-e2e-<random>`, on free ports) beside a developer's `gkm-edge`, instead of skipping wherever one exists, and its teardown refuses to remove the default edge. The hint printed when an app does not answer through the edge names the edge's real project.
