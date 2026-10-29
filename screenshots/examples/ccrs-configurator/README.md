# CCRS configurator screenshots

The CCRS / DIGIT configurator, read-only: the sign-in screens from a signed-out browser, the
account menu and pages, and all 32 Management Studio routes, with every route's API calls checked.

```bash
export CCRS_URL=http://localhost                       # default
export CCRS_EMAIL=you@example.org CCRS_PASSWORD=...    # a Keycloak account with a password
# or, for an account made by magic-link sign-up (it has no password), a saved session:
export CCRS_STORAGE_STATE=/path/to/signed-in-state.json
export CCRS_WORKSPACE="Nairobi City County"            # the workspace to pick on the chooser
cd screenshots && ./shots run examples/ccrs-configurator/plan.yaml
```

The account's workspace must have **finished onboarding**: Management Studio opens only after the
last step (before that, `/manage` redirects to onboarding Home and the console flows stop with a
message saying so). The sign-in flow works on any stack.

What it shows about the tool:

- **A guard for an app whose reads are POSTs.** DIGIT reads with `POST .../_search`, so the plan
  blocks DIGIT's write verbs (`_create`, `_update`, `_transition`...) instead of POST.
- **A multi-step sign-in** (Keycloak asks for the email, then the password, then a workspace),
  with the workspace chooser as a hook (`hooks.py`) because its markup differs between sign-up and
  sign-in.
- **A mode switch** before the console (`management_mode`): an account still onboarding is
  redirected away from `/manage`.

A saved session: sign in once in a browser Playwright controls and save
`context.storage_state(path=...)`, or reuse `out/.signed-in.json` from an earlier password run.
