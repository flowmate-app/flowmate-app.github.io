# Contributing to FlowMate

FlowMate is free and open source (MIT). Two ways to take part:

**Make your own version.** Fork the repository and change whatever your lab, instrument or course
needs — you don't have to ask. A note telling me what you built is always welcome.

**Build it together.** New features, support for more instruments, validation on your own data, or
fixing what you found: email **rlshir302010@gmail.com** or open an issue, and let's plan it.

## Reporting a problem

Open an [issue](https://github.com/rlshir302010-cpu/flowmate/issues) — the Feedback button in the app
prefills one. Say what you did, what you expected and what happened. Never attach data you are not
allowed to share; a description, a screenshot of the plot, or a small public example is enough.

## Working on the code

FlowMate is plain JavaScript with no framework and no npm dependencies. The source in
`FlowMate/src` is concatenated by `FlowMate/build.py` into one offline HTML file.

```
python FlowMate/build.py          # → FlowMate/dist/FlowMate.html (open it in Chrome or Edge)
bash FlowMate/tests/run_all.sh    # every test suite, in headless Chrome
python tools/build_site.py        # the website in docs/ (landing page + app)
```

The tests need Google Chrome; the storage tests need Node 22+. Statistics come from PlotMate's
engine (`PlotMate/src/core`), checked against GraphPad Prism and R.

**Rules that keep FlowMate trustworthy**

- A change to how events are counted or a statistic is computed needs a test against an independent
  reference (FlowKit, R, Prism, published values) — not against FlowMate's own earlier output.
- Never tune code until a reference number matches. Find the cause, fix that, and check the fix on
  data that was not used to find it (see `FlowMate/tests/external_qa`).
- Data stays on the user's computer: no network requests with user data, ever.
