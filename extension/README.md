# scout boards

Scout's work as a Kanban, beside the Vercel Board rooms Scout follows. It opens
in a browser at http://localhost:4802 and reads everything from Scout's runtime
on this host.

```sh
scout boards                 # start it and open the page
scout boards --no-open       # start it without opening a browser
scout boards --port 4900     # another port
scout boards setup           # start the runtime, give Claude Code the board tools
```

If Scout boards already runs, `scout boards` opens it. The command runs
`npx -y github:openscout-app/boards`, so it needs Node 20 or later.

More: https://github.com/openscout-app/boards
