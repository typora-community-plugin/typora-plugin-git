# Typora Plugin Git

English | [中文](./README.zh-CN.md)

A plugin for [Typora](https://typora.io) based on [typora-community-plugin][core].

## Features

- Open the **Git** sidebar in the activity bar, showing "Staged" and "Changes" sections as a directory tree, with each file's change status (M/A/D/R/C/U)
- Stage / unstage individual files or entire folders, or stage / unstage everything at once
- Type a commit message in the sidebar to commit staged changes directly (`Ctrl + Enter` for quick commit)
- Click an unstaged **modified file** to open a read-only inline Diff view; click a **deleted file** to view its content at `HEAD`; other files open directly in the editor
- If the current folder is not a git repository, initialize it directly from the sidebar

## Preview

![](./docs/assets/base.gif)

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Refresh interval (ms) | Interval for polling git status in the panel, minimum `300`; refreshing pauses when Typora is not active | `1000` |

## Installation

1. Install [typora-community-plugin][core]
2. Open "Settings -> Plugin Marketplace", search **Git** and install it.

> Note: Git must be installed on your system, and `git` must be available via PATH.

[core]: https://github.com/typora-community-plugin/typora-community-plugin
