# CCRS configurator onboarding videos

The five onboarding videos of the CCRS / DIGIT configurator, recorded on a **local** DIGIT stack
with a Nairobi workspace.

| # | Video | What it shows |
|---|-------|---------------|
| 1 | `01-setting-up-your-account.mp4` | sign-up (magic link from Mailpit), account details, the welcome tour, Home |
| 2 | `02-account-branding.mp4` | logo, name, theme; then saving without a logo (it's optional) and adding it later |
| 3 | `03-defining-your-geography.mp4` | all three ways in, each saved: the preconfigured official set (Nairobi, county → sub-county → ward), Fetch boundaries from OpenStreetMap (levels ticked and named), the same areas from Excel |
| 4 | `04-adding-departments-and-employees.mp4` | departments and designations by hand, then from a spreadsheet; employees by hand, then from a staff list (also as `.part-departments` / `.part-employees`) |
| 5 | `05-complaints-template.mp4` | categories and subcategories by hand, then from a spreadsheet; finish setup; Management Studio |

Every video ends on "For more information, check out our documentation page." with the cursor on
the page's Documentation rail.

```bash
cd videos
./redo.sh --project examples/ccrs-configurator             # all five (about an hour: three passes, each from a rewind)
./redo.sh --project examples/ccrs-configurator --only 3    # one video
./redo.sh --project examples/ccrs-configurator --lines     # the narration script
```

## How it's put together

- **Three passes** (`scenes/index.mjs`), because Geography, departments, employees and complaints
  can each be set up once per workspace:
  - *by-hand*: account, branding, geography, departments, employees, complaints;
  - *from-spreadsheets*: account (off camera), branding without a logo, then every step's Excel /
    bulk-upload path;
  - *fetch*: account and branding (off camera), then Fetch boundaries from OpenStreetMap.
- **Rewind** (`lib/stack.mjs`): both Postgres databases (`egov`, `keycloak`) are recreated from
  `<db>_video_baseline` template databases (about a second each), Redis is flushed, and the app
  containers restart in dependency waves (MDMS before enc-service before egov-user...), 2 to 4 minutes.
  The stack is also stopped while new narration is voiced, to leave the voice model its 2 GB.
- **Uploads** (`lib/make_sheets.py`, run by the `prepare` hook): the spreadsheets the second pass
  uploads are built from the same `data/nairobi.json` the first pass types, in the configurator's
  own template layouts.
- **Remote stacks** are never rewound: point `baseUrl` elsewhere and give each pass its own
  workspace in `data.passes` (account, founder, email domain). The narration doesn't change.

## What to edit

- `data/nairobi.json`: the founder, account name/code/URL, country, logo, theme, the place
  searched in Geography (`geography.fetchPass` for the OpenStreetMap levels), departments,
  designations, employees (roles and areas), complaint categories, and the voice.
- `data/nairobi-boundaries.json`: the 104 Nairobi areas for the Excel upload, taken from the
  stack's official-boundaries service: `../../.venv/bin/python lib/boundaries_from_turbopass.py "Nairobi" "Nairobi — County" data/nairobi-boundaries.json`.
- `scenes/*.mjs`: the captions and the pacing.
- `assets/nairobi-logo.png`: a placeholder monogram.

## Stack prerequisites

- A local DIGIT deploy (`local-setup/ansible/deploy.sh`, compose project `digit`) with the
  configurator at `http://localhost/configurator/`, Keycloak **magic-link sign-up** through Mailpit
  (`127.0.0.1:18025`), and turbopass with the official-boundaries database.
- The baseline, taken once after every redeploy on a stack nobody has signed up on yet:
  `./redo.sh --project examples/ccrs-configurator --resnapshot`.
- After a redeploy, check the scenes against the new screens with `--lines` and one take of each video.
