# Architecture

Five diagrams of how gkm works. Each is a Figma frame exported at full width —
click any of them to zoom.

The source is one Figma file, [gkm
Architecture](https://www.figma.com/design/UmGUekNbRdT9TWMWVWoMbd/gkm-Architecture),
where every shape is a component: a database is a cylinder, a container has
window chrome, a bucket is a vessel, a site is a browser window. Changing a shape
once changes it in all five.

## What a construct becomes

![One declaration, the manifest it becomes, and what a target builds](/architecture/constructs-pipeline.png)

A declaration on the left. The manifest — ids, kinds, and the edges between them
— in the middle. On the right, what a real Dokploy deploy built from it.

## A surface is a server

![One container serving two surfaces, against one server per surface](/architecture/surface-is-a-server.png)

`Api` and `Auth` are both `rest-api` declarations. What separates them is the
endpoint knowing which surface it belongs to — which is what an endpoint created
*from* its surface gives you.

## Where does this construct live?

![Three layers of backend resolution, narrowing as they get more specific](/architecture/backend-resolution.png)

A target-aware default, a per-concern override, and — not built yet — a
per-construct one. A construct falls through until something answers, and the
answer is always one of the same three backend names.

## Same client, different address

![Local and deployed topologies converging on one call site](/architecture/local-and-deployed.png)

Locally Caddy is the edge because nothing else is. On Dokploy, Traefik already
is one. The client is identical; the scheme in the injected URL picks the driver.

## One kind, three answers

![Eight kinds and what each resolves to per target](/architecture/kind-per-target.png)

Where a kind resolves to nothing on a target, that is marked rather than hidden.
