# MCP actions

The server is `bin/sfcc-data-mcp.mjs`. `sfcc-data init` registers it in the SFCC project and copies the contribution rule there. `sfcc-data init --check` verifies that both files are still this CLI version.

It reads `sfcc-data-config.yaml`, the rules in [`docs/contribute-xml.md`](docs/contribute-xml.md), and the contract [`docs/design/2026-10-13-ecom-data-splitter.md`](docs/design/2026-10-13-ecom-data-splitter.md). It does not write monolithic XML, and `list_aliases` does not return the secret.

Fragment tools write into the project trees. `compose`, `split_archive`, and `merge_archive` use the same engine as the CLI.

## Fragments

| Tool | Effect |
|---|---|
| `list_rules` | How to contribute each XML: path, archive, element |
| `find` | Find a fragment by id |
| `create_fragment` | Write a new fragment. Next free rank, without renumbering. Refuses to overwrite |
| `update_fragment` | Replace the XML of a fragment that is already there |
| `delete_fragment` | Delete the file. Does not renumber. Reports groups that still cite the id |
| `validate` | One element, the right name, the required ids, no `<?xml` and no `xmlns` |
| `compose` | Produce the recomposed archive (`meta`, `sites`, or a subset) |

`create_fragment` receives the inner XML, a single element, without `<?xml` and without `xmlns`. It refuses a path outside the rules, a rank that is already taken, and it does not modify `data-splitter.yaml`.

## Archives

| Tool | Command |
|---|---|
| `split_archive` | `sfcc-data split <site-import.zip>` |
| `merge_archive` | `sfcc-data merge <archive.zip> [--from …]` |

`--from` is `sites-dev` (default), `sites`, `meta`, or `test/<case>`. A test case is zipped as-is.

## Instance

| Tool | Command |
|---|---|
| `list_aliases` | `sfcc-data ocapi list`. Alias names. Never the secret. Hosts and Staging certificates are in `.sfcc-data-instances.yaml` |
| `download_instance` | `sfcc-data download <instance>` |
| `upload_instance` | `sfcc-data upload <instance> [--from …]` |

There is no tool to save or remove an alias: the OCAPI secret stays on the machine, entered through `sfcc-data ocapi add`. WebDAV passwords and Staging certificates stay in `.sfcc-data-instances.yaml`.
