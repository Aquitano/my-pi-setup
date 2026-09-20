# my pi setup

Install as a Pi package from GitHub:

```sh
pi install git:github.com/Aquitano/my-pi-setup
```

For your own fork, replace `Aquitano` with your GitHub username. Requires Pi 0.82 or newer and Node.js 24.16 or newer. Run `/reload` in Pi after installation.

This setup is fairly opinionated, it:

- sets up github dark default as the theme
- adds firecrawl tools for searching and scraping
- updates the bottom bar to have the info I prefer to see
- adds background terminals + ui to manage them
- adds subagents to pi, optionally isolated in their own git worktree
- adds workflows to pi
- adds an ask user tool, which lets the model ask up to four multiple choice questions at once, with multi-select
- adds first-class `fd` (file discovery) and `rg` (content search) tools, replacing the built-in `find` and `grep`
- defers the web, background terminal, and workflow tools out of the system prompt until the model loads them with `load_tools`

![Pi setup interface](assets/pi-setup.jpeg)

See [Setup](./SETUP.md) for the theme, optional Firecrawl integration, subagent permissions, and development commands. Claude and Codex subagents default to automatic permission review.

## License

Based on [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup). The original MIT license and attribution are preserved.

This project is MIT-licensed, including prior commits. See [LICENSE](./LICENSE) and [issue #20](https://github.com/davis7dotsh/my-pi-setup/issues/20).
