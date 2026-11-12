# sfcc-data

CLI to split, recompose, and exchange Salesforce B2C Commerce site-import archives. The grain contract is [`docs/design/2026-10-13-ecom-data-splitter.md`](docs/design/2026-10-13-ecom-data-splitter.md). Fragments, ranks, and `data-splitter.yaml` stay in the project repository. The XSDs are in `dwapp-schema/` here. Without `schemaDir`, `compose` and `split` read that folder.

The MCP server is `bin/sfcc-data-mcp.mjs`. Contribution rules are [`docs/contribute-xml.md`](docs/contribute-xml.md). In an SFCC project:

```bash
sfcc-data init
sfcc-data init --check
```

`init` writes `sfcc-data-config.yaml` at the project root when it is missing, `.cursor/mcp.json` (the `sfcc-data` server; other servers stay), and `.cursor/rules/sfcc-data-xml.mdc`. An existing config file is not rewritten. `install mcp` does the same thing. `--check` fails when one of those files is missing, or when the MCP entry and the rule are no longer this CLI version. Run `init` again to refresh them.

## Install

Node `>=20.19.0`. `zip` and `unzip` must be on `PATH`. So must `sfcc-ci`, to talk to an instance:

```bash
npm install -g sfcc-ci
```

Clone this repository next to the SFCC project, then:

```bash
cd sfcc-data-cli
npm install
npm link
```

`npm link` puts `sfcc-data` on `PATH`. Without the link, call `node /path/sfcc-data-cli/bin/sfcc-data.mjs`. From `b-bolle-brands-b2c`, that is `node ../sfcc-data-cli/bin/sfcc-data.mjs`.

`sfcc-data-config.yaml` lives at the SFCC project root. Paths are relative to that file. The command looks in the current directory, then in its parents.

```yaml
# Paths are relative to this file.
# sfcc-data looks for this file in the current directory, then in parent directories.
# download and split replace meta (when the download has metadata), sites, and sites-dev.
# They do not write sites-test.

# Split metadata: system types, custom types, and attribute groups.
ecom-data-meta: ecom-data/ecom-data-meta

# Catalog configuration only: header, categories, assignments, recommendations, options, variation attributes.
# Products belong in ecom-data-sites-dev. merge --from sites is meta plus this tree.
ecom-data-sites: ecom-data/ecom-data-sites

# Full development dataset. Default source for merge and upload (--from sites-dev): meta plus this tree.
ecom-data-sites-dev: ecom-data/ecom-data-sites-dev

# One subfolder per test case. Monolithic XML, zipped as-is by merge --from test/<case>.
# download and split never write here.
ecom-data-sites-test: ecom-data/ecom-data-sites-test

# Splitter contract: ranks and the import filter. Optional.
# When omitted, sfcc-data uses data-splitter.yaml next to the parent of ecom-data-meta.
splitter: ecom-data/data-splitter.yaml
```

| Key | Contents |
|---|---|
| `ecom-data-meta` | Split metadata |
| `ecom-data-sites` | Catalog configuration only |
| `ecom-data-sites-dev` | Full development dataset |
| `ecom-data-sites-test` | One subfolder per test case. Monolithic XML, not fragments |
| `splitter` | Optional. Default: `data-splitter.yaml` next to the parent of `ecom-data-meta` |

`download` and `split <zip>` replace `ecom-data-meta` (when the download has metadata), `ecom-data-sites`, and `ecom-data-sites-dev`. They do not touch `ecom-data-sites-test`.

## Instance alias

`sfcc-ci` authenticates an Account Manager client: a client id and a client secret. The secret is not an OCAPI key on its own. Instance hostnames, the WebDAV user and password, the Staging P12 (`webdav.p12`, and `webdav.passphrase` when the file has one), and which OCAPI alias to use live in `.sfcc-data-instances.yaml` at the project root. The `all` entry is the default. An instance overrides only the keys it sets. `init` adds that file name to `.gitignore` and, in a terminal, asks for every value that is still empty.

```bash
sfcc-data ocapi add
sfcc-data ocapi list
sfcc-data ocapi rm <alias>
sfcc-data job install
sfcc-data job install stg
```

`add` asks for the alias and the OCAPI client id and secret. The instance URL and the Staging certificate are not part of the alias: each host and each P12 are in `.sfcc-data-instances.yaml`. `list` never prints the secret. `job install` imports the `sfcc-data-site-export` job onto the instance. With no instance name, it installs the job on every instance in the file. `download` does not run that job.

## sfcc-ci commands

`sfcc-data` calls `sfcc-ci` 2.13. The client id and secret travel as `SFCC_OAUTH_CLIENT_ID` and `SFCC_OAUTH_CLIENT_SECRET`. `client:auth` runs before an export, an upload, or a job install.

| Step | What runs |
|---|---|
| `download` export | `instance:export -s --failfast`. The data units are `DEFAULT_EXPORT`, or the file passed with `--data`. |
| `download` fetch | WebDAV GET of `impex/src/instance/<file>.zip`. `sfcc-ci` 2.13 has no download command. With a WebDAV user and access key, the request uses that login. Otherwise it uses the token from `client:auth:token`. A Staging P12 is attached to this GET. |
| `upload` and `job install` send | With a WebDAV user and access key, this CLI PUTs the zip with Basic authentication and attaches the Staging P12. Otherwise `instance:upload` sends it, and passes that P12 with `-c` and `-p`. |
| `upload` and `job install` import | `instance:import -s --failfast`. On Staging, when a P12 is set, this CLI posts `sfcc-site-archive-import` and polls the execution: `instance:import` has no certificate option. |

`instance:export` leaves an existing zip in place. `download` picks a new file name on each run.

## Permissions to add

`download`, `upload`, and `job install` start `sfcc-site-archive-export` or `sfcc-site-archive-import`, then read or write the zip on WebDAV `/impex`. Add the job permission and the WebDAV permission on every instance. Use the same Account Manager client id as `sfcc-data ocapi add`.

`sfcc-ci` starts the job on the OCAPI Data API. When that API is still enabled, add the client in Business Manager. When the instance rejects OCAPI (`OcapiDeprecatedException`), grant the SCAPI scope instead. WebDAV stays a Business Manager setting in both cases: SCAPI does not upload the archive.

### SCAPI

In Account Manager, on the API client, add the scope `sfcc.jobs.rw`. That scope runs a job and reads its execution. `sfcc.jobs` only reads executions, so `download` and `upload` still fail with it.

The client also needs the realm short code and tenant id for a SCAPI caller. `sfcc-ci` 2.13, which this CLI shells out to, still posts the job to `/s/-/dw/data/v19_5/jobs/{job_id}/executions`. A disabled Data API keeps rejecting that call until the instance allows this client there, or the job is started by a SCAPI client.

### OCAPI

Business Manager: Administration > Site Development > Open Commerce API Settings. Select type **Data** and the global context. Add this client to the existing `clients` array. Replacing the whole document removes the other clients.

```json
{
  "client_id": "<account manager client id>",
  "resources": [
    {
      "resource_id": "/jobs/*/executions",
      "methods": ["post"],
      "read_attributes": "(**)",
      "write_attributes": "(**)"
    },
    {
      "resource_id": "/jobs/*/executions/*",
      "methods": ["get"],
      "read_attributes": "(**)",
      "write_attributes": "(**)"
    }
  ]
}
```

`POST /jobs/*/executions` starts the export or the import. `GET /jobs/*/executions/*` reads the execution until it finishes. A `ClientAccessForbiddenException` on `download` or `upload` means this client is missing from that document.

### WebDAV

Business Manager: Administration > Organization > WebDAV Client Permissions. Add the client. `/impex` is the only path this CLI uses. The API client needs this grant for `instance:upload`. The WebDAV user from `.sfcc-data-instances.yaml` needs the Business Manager permission **WebDAV Transfer Files** for the Basic upload and for `download`. The access key is the WebDAV password created for that login. It is not the Account Manager client secret.

```json
{
  "client_id": "<account manager client id>",
  "permissions": [
    { "path": "/impex", "operations": ["read_write"] }
  ]
}
```

Outside a terminal, flags replace the questions. The secret can come from `SFCC_OCAPI_PASS`.

```bash
sfcc-data ocapi add \
  --alias sfcc-data \
  --ocapi-key "$SFCC_OCAPI_KEY"
# SFCC_OCAPI_PASS in the environment
```

The first save creates `~/.sfcc-data-salt`: 32 random bytes, mode `0600`. That file is the AES-256-GCM key, not a public salt. A salt alone encrypts nothing. `~/.sfcc-data-keys` holds the ciphertext, an IV, and an authentication tag, mode `0600`. Losing the key file makes the aliases unreadable. Do not commit either file, and do not commit `.sfcc-data-instances.yaml`. `sfcc-data` passes the secret to `sfcc-ci` through `SFCC_OAUTH_CLIENT_ID` and `SFCC_OAUTH_CLIENT_SECRET`. A P12 passphrase from the instances file is passed to `sfcc-ci` with `-p` during an upload, so it can show up in the process list for that upload. WebDAV uses the user, password, and certificate from the instances file.

`SFCC_DATA_HOME` moves both files. Useful for a test. Default: the home directory.

## Last modified

The site-import schemas in `dwapp-schema/` carry no `last-modified`. `creation-date` exists on orders and customers, which `download` excludes. An export cannot say whether a preference, a job, or a slot changed since the last commit.

OCAPI Data can limit a response to the id and the dates. Grant `get`, and `post` only where the resource is a search. Leave `write_attributes` empty. Skip `put`, `patch`, and `delete`.

```json
{
  "client_id": "<account manager client id>",
  "resources": [
    {
      "resource_id": "/products/*",
      "methods": ["get"],
      "read_attributes": "(id,last_modified,creation_date)",
      "write_attributes": "()"
    }
  ]
}
```

Products, content folders, and system object type definitions expose `last_modified`. Repeat the block for each other Data resource whose document has that property. The instance lists them at `https://<host>/dw/meta/rest/data/v19_5?client_id=<client>`.

A SCAPI scope such as `sfcc.products` returns the whole product. `read_attributes` is the setting that keeps the response to the id and the dates.

Site preferences, services, shipping methods, payment, slots, URL rules, and static files have no per-fragment `last_modified`. On a system type, the date is the type, not each attribute file under `ecom-data-meta`.

Static files expose `getlastmodified` through WebDAV PROPFIND. A read grant on `/Libraries` or catalog static also allows downloading the file. This CLI reads and writes `/impex` only. Content assets travel inside the site-export zip.

### Who changed it

Business Manager: Administration > Operations > Change History. Turn tracking on for each module. An event records the user or the job, the time, the action (creation, update, deletion), and the object. Events can take up to 15 minutes to appear. Salesforce documents this screen for Staging and Production.

Tracked objects: catalogs and categories, content assets, custom objects, customer groups and lists, scheduled jobs, library folders, price books, products, recommendations, shared product options, shared variation attributes, sites, source codes, stores, system object types.

History tabs are absent for A/B tests, campaigns, coupons, promotions, search, slot configurations, and sorting rules.

Change History is a Business Manager screen. The role that opens it also sees the JSON of the object after the change.

Where `last_modified` exists, an instance date newer than the fragment's commit means `upload` can overwrite a Business Manager edit. Matching XML still requires comparing the export to the file. Preferences, services, slots, and the other types without a date use that same content comparison.

## Commands

```bash
sfcc-data compose
sfcc-data split site-import.zip
sfcc-data split --input /path/to/export --out /tmp/ecom-split --update-ranks
sfcc-data merge /tmp/site-import.zip
sfcc-data merge /tmp/catalog.zip --from sites
sfcc-data merge /tmp/hse.zip --from test/hse
sfcc-data download stg
sfcc-data upload sb01
sfcc-data upload sbx --from test/hse
sfcc-data apply-export --mode merge --dir ecom-data/site-exports
sfcc-data install-layout --from /tmp/split --into ecom-data
```

| Command | Role |
|---|---|
| `compose` | Fragments → `ecom-data/.composed/`. Defaults come from `sfcc-data-config.yaml` when it exists |
| `split <zip>` | Unzip, split, and place into meta, sites, and sites-dev |
| `split --input --out` | Write the raw tree under `--out`. Does not place it into the project. `refresh-archives.sh` uses this form |
| `merge <zip>` | Write the requested zip. Default `--from sites-dev`: meta + full dataset. `sites`: meta + catalog configuration. `meta`: meta only. `test/<case>`: that case folder, as-is |
| `download <instance>` | `sfcc-ci instance:export`, WebDAV GET of the zip, then `split`. The instance comes from `.sfcc-data-instances.yaml`. `--data` replaces the unit JSON. `--update-ranks` adds ranks |
| `upload <instance>` | `merge` into a temporary zip, `sfcc-ci instance:upload` (or the WebDAV user), then `sfcc-ci instance:import`. On Staging with a P12, the import is the direct OCAPI call. Same `--from` as `merge` |
| `job install [instance...]` | Import the `sfcc-data-site-export` job through the same upload path. A `download-file-pattern` containing `no-static` drops global, catalog, and library static files from that job |
| `apply-export` | Apply an export already on disk whose name starts with `STG`, `PROD`/`PRD`, or `DEV`/`SB` |
| `install-layout` | Place a raw split into the three folders, under one parent |

`download` excludes customer lists, Business Manager users, OCAPI settings, and WebDAV permissions. The export includes libraries and their static files, so content assets are in the zip, plus catalogs and catalog static files, inventory lists, price books, every site, and global data (preferences, metadata, jobs, services, and the other units of the export). Services in that zip can contain secrets. Review them before committing.

The file name on the instance is unique. `instance:export` does not overwrite a zip that is already there.

```bash
npm test
```
