# Browser checks

These drive a real Chrome against a running BUYBUDDY web build and fail loudly, so
a claim like "0 problems" can be re-run instead of trusted.

```
bash tools/shot/setup.sh          # first time: Chrome + system libraries
npx puppeteer browsers install chrome

APP=http://127.0.0.1:8099 node walk.js        # 48 routes x 6 roles, screenshots + console errors
APP=http://127.0.0.1:8099 node sweep360.js    # 45 screens at 360 px and 320 px
APP=http://127.0.0.1:8099 node offline.js     # every /api call blocked, then restored
APP=http://127.0.0.1:8099 node a11y.js        # axe-core WCAG 2.1 A/AA
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `APP` | `http://127.0.0.1:8099` | build under test |
| `W` | `390` | viewport width. Accessibility is only meaningful at more than one — the desktop sidebar and the mobile tab bar share no colours |
| `PW` | local dev password | password for the six demo accounts |
| `OUT` | `~/shots` | where the report and failing screenshots are written |

`a11y.js` writes `report.json` (rule, impact, node count, screens, first example)
and one screenshot per failing screen. `cardtap.js` proves the two gestures on a
product card still do what they should: the photo opens the product, **+** adds to
the cart.

Seven of the sixteen fixes in the 2.9 accessibility round were only visible in the
built CSS or at desktop width — run the sweep at 390 **and** 1360 before believing
a green result.
