# Content plugins

Content plugins fetch JSON, evaluate whether they are active, render an image, and store the result
as a normal frame artifact. Signed-in frame owners can create and manage plugin instances at
`/plugins`; direct PostgreSQL configuration remains useful for development and diagnostics.

## Local preview environment

Render the square plugin without PostgreSQL, the web server, or a physical frame:

```bash
bun run plugin:render
```

The palette-accurate PNG is written to `data/plugin-previews/square.png`. This directory is ignored by
Git apart from its scaffold file.

Render both preview and device formats with explicit fixtures:

```bash
bun run plugin:render -- square \
	--input scripts/plugin-fixtures/square-input.json \
	--config scripts/plugin-fixtures/square-config.json \
	--output data/plugin-previews/my-square.png \
	--pf7a data/plugin-previews/my-square.pf7a
```

`--input` also accepts an HTTP or HTTPS URL. `--config` accepts a JSON file or an inline JSON object.
Use `--at 2026-08-09T12:00:00Z` to make time-dependent plugins repeatable. Run
`bun run plugin:render -- --list` to see the registered plugin keys.

## Berlin events plugin

The `berlin-events` plugin reads the official Berlin Open Data list of Berlin and Brandenburg street
and folk festivals. It validates the SimpleSearch JSON response, excludes Brandenburg by default,
keeps current and upcoming entries, and renders up to four events in chronological order.
The API does not provide event images, so the renderer uses a one-dimensional timeline layout and
palette-safe halftone accents.

- [Dataset details](https://daten.berlin.de/datensaetze/simple_search_wwwberlindesenwebservicemaerktefestestrassenvolksfeste)
- [SimpleSearch API documentation](https://berlinonline.github.io/open-data-handbuch/simplesearch-api/)
- API endpoint: `https://www.berlin.de/sen/web/service/maerkte-feste/strassen-volksfeste/index.php/index/all.json?q=`

Render the repeatable local fixture:

```bash
bun run plugin:render -- berlin-events \
	--at 2026-08-09T10:00:00+02:00 \
	--pf7a data/plugin-previews/berlin-events.pf7a
```

The instance configuration supports:

- `title`: heading with at most 40 characters.
- `maxEvents`: one to four rows.
- `daysAhead`: include events beginning within this many days.
- `districts`: optional exact district names such as `Mitte` or `Neukölln`.
- `includeBrandenburg`: include entries outside Berlin when true.
- `showAddress`: show postcode and street.
- `accent`: `red`, `blue`, `green`, or `orange`.

For a live instance, use `berlin-events` as `plugin_key` and the API endpoint above as
`endpoint_url`. A suitable config is:

```json
{
	"title": "BERLIN / DIESE WOCHE",
	"maxEvents": 4,
	"daysAhead": 14,
	"districts": ["Neukölln", "Friedrichshain-Kreuzberg"],
	"includeBrandenburg": false,
	"showAddress": true,
	"accent": "red"
}
```

## Mannheim events plugin

The `mannheim-events` plugin reads the official Mannheim city calendar directly. Its source adapter
collects upcoming occurrences and the plugin collapses identical titles. Titles listed on more than
two distinct dates are excluded by default, which keeps long-running exhibitions from displacing
concerts, performances, markets and other short events.

Render the local fixture:

```bash
bun run plugin:render -- mannheim-events \
	--at 2026-08-18T09:00:00+02:00 \
	--pf7a data/plugin-previews/mannheim-events.pf7a
```

Configuration supports `title`, `maxEvents` (one to four), `daysAhead`, `maxDurationDays`,
`showVenue`, and `accent`. The plugin owns its calendar fetch, so existing instances that point to
the former local JSON adapter continue to work without making that internal HTTP request.

Source: [Mannheim event calendar](https://www.mannheim.de/de/veranstaltungen).

## Berlin tram disruptions plugin

The `berlin-tram-disruptions` plugin reads BVG's public disruption-report JSON and keeps traffic
notices that affect tram lines. It can show all affected lines or a configured subset.

Live endpoint:

```text
https://www.bvg.de/disruption-reports-service/disruptions/v1/de
```

Render the local fixture:

```bash
bun run plugin:render -- berlin-tram-disruptions \
	--pf7a data/plugin-previews/berlin-tram-disruptions.pf7a
```

Configuration supports `title`, `maxDisruptions` (one to four), `lines` (for example `M1` or
`M8`), and `showDates`.

## Stuttgart Stadtbahn disruptions plugin

The `stuttgart-stadtbahn-disruptions` plugin reads current VVS EFA AddInfo notices and keeps
notices affecting `U` Stadtbahn lines. It includes notices active now and those beginning within a
configurable horizon.

Live endpoint:

```text
https://app.vvs.de/vvs/XML_ADDINFO_REQUEST?outputFormat=rapidJSON&filterPublicationStatus=current&serverInfo=1
```

Render the local fixture:

```bash
bun run plugin:render -- stuttgart-stadtbahn-disruptions \
	--pf7a data/plugin-previews/stuttgart-stadtbahn-disruptions.pf7a
```

Configuration supports `title`, `maxDisruptions` (one to four), `lines` (for example `U4` or
`U13`), `daysAhead`, and `showDates`.

## Square plugin

The starter plugin is registered as `square`. It requires a JSON endpoint but intentionally ignores
the response content. A successful response produces a square on an 800×480 background.

The repository includes a static JSON response at `/plugin-inputs/square.json`. Create an instance
for frame `1` with:

```sql
insert into plugin_instances (
	frame_id,
	plugin_key,
	name,
	endpoint_url,
	enabled,
	poll_every_seconds,
	compare_meaningful_changes,
	display_mode,
	config,
	next_run_at,
	created_at,
	updated_at
) values (
	1,
	'square',
	'Square test',
	'http://127.0.0.1:3000/plugin-inputs/square.json',
	true,
	300,
	true,
	'immediate',
	'{"x":310,"y":150,"size":180,"fill":"black","background":"white"}'::jsonb,
	now(),
	now(),
	now()
);
```

Change the frame ID and endpoint host for the deployment. The scheduler checks for due instances
every 15 seconds. `immediate` displays a newly rendered image immediately; `rotation` only adds it to
the normal eligible image pool.

Supported square configuration:

- `x`: left position from 0 to 799.
- `y`: top position from 0 to 479.
- `size`: side length from 1 to 480. The renderer clips it at the screen edge.
- `fill`: `black`, `red`, `green`, `blue`, `yellow`, or `orange`.
- `background`: `white` or `black`.

Inspect the latest runner status with:

```sql
select
	id,
	name,
	last_status,
	last_error,
	last_fetched_at,
	last_success_at,
	next_run_at
from plugin_instances
order by id;
```

Disable an instance without deleting its generated artifact:

```sql
update plugin_instances set enabled = false, updated_at = now() where id = 1;
```

Only trusted administrators should configure endpoint URLs directly. The runner limits requests to
HTTP or HTTPS, ten seconds, and 1 MiB, but private-network blocking and secret management should be
added before endpoint configuration is exposed in the UI.
