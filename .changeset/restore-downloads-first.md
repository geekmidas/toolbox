---
'@geekmidas/cli': patch
---

`backup:restore` downloads the whole file before it loads it

`backup:restore` streamed each file's S3 response straight into the one-off
container's stdin. Over a remote engine (SSH), that stdin holds the response
back for as long as psql takes. On a large import (~77 MB gzipped), the
response could be cut off partway. The cut-off stream then closed the
container's stdin as though the file had ended, so `gunzip` reported
`unexpected end of file`, psql failed mid-row, and the only error was
`RestoreFailed … psql exited 3`.

Now the restore downloads the file to a private temporary folder first, checks
that every byte of the object's `ContentLength` arrived, and then loads it from
disk. A short download stops with `BackupDownloadIncomplete` (the bytes
received against those expected) before anything changes. For `--from`, the
download also happens before the apps are stopped, so a slow download costs no
downtime. A one-off container whose stdin fails partway now rejects with
`StdinNotDelivered` instead of passing a short input off as a whole one.
