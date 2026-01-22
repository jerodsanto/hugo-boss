# Hugo Boss 💪

Hugo bloggin' with Obsidian like a boss. Preview, publish, and deploy your Hugo blog without leaving your editor.

> Remember when people used to say *boss*, when they were describing something that was really cool? Like:
>
> "Those shoulder pads are really boss, man."
>
> "Look at that perm, that perm is so boss."
>
> It's what made me want to become a boss. And I looked so good in a perm and shoulder pads. But now, boss is just slang for jerk in charge.
>
> – [Michael Scott](https://www.youtube.com/watch?v=tqtFAqILoOw)

## Obsidian + Hugo

There are multiple ways to make Obsidian and Hugo play nice. I like to keep my Hugo site outside my Obsidian vault and symlink the content so I can write in Obsidian.

My Hugo site lives in: `~/src/jerodsanto/net`

My Obsidian vault lives in: `~/Dropbox/obsidian/Jerod`

So I created a symlink like so:

```
ln -s ~/src/jerodsanto/net/content/posts ~/Dropbox/obsidian/Jerod/blog
```

You could also create a new Obsidian vault that points directly at your Hugo content directory. This plugin *should* manage that setup just fine (I believe, haven't tested it).


## Features

### New Post

Create a new blog post with one click. Uses your configured template file, or falls back to a basic frontmatter structure if no template is specified.

### Preview Site

Start a local Hugo server and preview your site in a split pane right inside Obsidian. The preview automatically opens to the current blog post you're editing, complete with Hugo's built-in live reload.

### Publish Post

Prepare a draft for publishing with one click:

- Validates that the post has a title and content, if so:
- Moves the post to your configured publish path (default: `YYYY/MM-slug`)
- If there's embedded files, creates a page bundle and copies them to it
- Sets the `date` frontmatter to the current time
- Sets `draft` to `false`

### Deploy Site

Build your Hugo site and deploy it with a configurable deploy command (e.g., `rsync` to a server)


## Installation

### From Obsidian Community Plugins

1. Open Settings → Community plugins
2. Search for "Hugo Boss"
3. Click Install, then Enable, then configure

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder called `hugo-boss` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the `hugo-boss` folder
4. Enable the plugin in Settings → Community plugins


## Configuration

Open Settings → Hugo Boss to configure:

| Setting | Description |
|---------|-------------|
| **Hugo site directory** | Path to your Hugo site (supports `~` for home directory) |
| **Obsidian Hugo directory** | Where Obsidian stores your Hugo posts (leave empty for vault root) |
| **Publish path** | Path template for published posts (default: `{YYYY}/{MM}-{slug}`) |
| **Hugo binary** | Path to the Hugo binary (leave empty to use system `PATH`) |
| **Deploy command** | Command to run after building (e.g., `rsync -az public/ user@host:~/site/`) |
| **Draft template** | Template to use for new posts (leave empty for basic frontmatter) |

### Publish Path Placeholders

Since Hugo doesn't care how you organize your content directory (it relies on frontmatter for permalinks, etc), you may choose where/how Hugo Boss moves your post into place to be published. I organize my directory by year and use the month in the post file names, so that's the default, but you can configure this however you like.

- `{YYYY}` - 4-digit year (e.g., 2026)
- `{MM}` - 2-digit month (e.g., 01)
- `{DD}` - 2-digit day (e.g., 15)
- `{slug}` - URL-friendly version of the title

**Examples** (assuming `blog` as your Hugo directory):

| Publish Path | Result |
|--------------|--------|
| `{YYYY}/{MM}-{slug}` | `blog/2026/01-my-post.md` (default) |
| `{YYYY}/{slug}` | `blog/2026/my-post.md` |
| `{YYYY}/{MM}/{DD}-{slug}` | `blog/2026/01/16-my-post.md` |
| `{slug}` | `blog/my-post` (flat structure) |

Note: For posts that have embedded files, it will create a page bundle instead. For example, two images embedded in the post will result in the following:

| Result |
|--------|
| `blog/2026/01-my-post/index.md` |
| `blog/2026/01-my-post/image1.jpg` |
| `blog/2026/01-my-post/image2.jpg` |


## Usage

Click the flexed bicep icon in any editor view to access the menu:

- **New Post** - Create a new blog post
- **Preview Site** - Toggle the Hugo preview server
- **Publish Post** - Publish the current draft
- **Deploy Site** - Build and deploy your site

The button shows an active state (accent color) when the preview server is running.


### Related Frontmatter

```yaml
---
title: "My Post Title"
slug: "my-post-title"  # optional, derived from title if not set
draft: true            # set to false on publish
date: 2026-01-15T...   # set automatically on publish
---
```

## Requirements

- Obsidian 1.0.0 or later
- Hugo installed on your system
- Desktop only (uses Node.js child_process for Hugo commands)

## Building from Source

```bash
# Clone the repository
git clone https://github.com/jerodsanto/hugo-boss.git
cd hugo-boss

# Install dependencies
npm install

# Build the plugin
npm run build

# For development (rebuilds on file changes)
npm run dev
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/hugo-boss/` directory.

## License

MIT

## Author

[Jerod Santo](https://jerodsanto.net)
