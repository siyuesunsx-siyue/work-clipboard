# Privacy

Parkit is local-first.

## What It Stores

The extension may store:

- copied text
- copied URLs
- screenshots copied to the Windows clipboard
- file paths copied through the Windows clipboard
- user-entered tags
- foreground app names and window titles captured at copy time
- local URL and file-path context metadata
- item status such as active or stashed

## Where Data Is Stored

Data is stored locally in Chrome IndexedDB for the extension page.

The Windows companion script keeps a short in-memory clipboard history while it is running and exposes it only on:

```text
http://127.0.0.1:18765/
```

## Network

This project does not include a remote backend and does not upload clipboard data.

The local companion endpoint is intended for the browser extension on the same computer.

The extension may fetch a copied URL to read its page title so the item is easier to identify later. This happens from the user's browser session and is not sent to a Parkit server.

## User Control

Users can:

- delete individual items
- export visible items
- stop the Windows companion with `stop-clipboard-watch.cmd`
- remove the extension from Chrome

## Limitations

Anyone with access to the same Windows user session may be able to access local clipboard content while the companion is running. Do not use this tool for secrets, passwords, tokens, or highly sensitive information.
