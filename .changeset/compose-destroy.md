---
'@geekmidas/cli': minor
---

`gkm compose --stage <stage> --destroy` deletes everything the stage's deploys made

It removes, in the order AWS needs:
- the stack, with its containers, volumes and routes on the shared edge;
- CloudFront distributions (disabled, then deleted), their origin access
  controls, headers policies and certificates;
- SNS subscriptions, topics and queues;
- IAM users, with their keys and policies;
- buckets, emptied of every version first;
- DNS records, including the CDN's name and its certificate's validation
  record, each deleted only while it holds the value gkm wrote.

Only what it can prove is the stage's is deleted: the `gkm:project` and
`gkm:stage` tags, a distribution's `gkm` comment, or the stage's own name. A
certificate or bucket gkm found and adopted is left where it is, and listed,
along with everything a distribution that stays still uses. Each resource is
forgotten as it goes, so a run that stops part way carries on.

It prints the whole plan, then asks you to type `<project>-<stage>`. No flag
skips that, and with no terminal it refuses; `--dry-run` prints the plan
anywhere. The stage's secrets are kept unless `--secrets` is passed. Secrets
stores gain an optional `delete(stage)`: file, SSM, Secrets Manager and S3,
where every kept version of the stage's secrets is deleted.
