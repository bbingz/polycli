<div align="center">

<img src="./docs/assets/readme-header.svg" alt="polycli: 複数の AI コーディング CLI を 1 つのコマンド体系で操作" width="100%">

# polycli

**普段使っている AI ホストの中で、9 種類の AI コーディング CLI を 1 つのコマンド体系から操作できます。**

[![GitHub release](https://img.shields.io/github/v/release/bbingz/polycli?label=release&color=111827)](https://github.com/bbingz/polycli/releases)
[![CI](https://github.com/bbingz/polycli/actions/workflows/ci.yml/badge.svg)](https://github.com/bbingz/polycli/actions/workflows/ci.yml)
[![npm: polycli-opencode](https://img.shields.io/npm/v/@bbingz/polycli-opencode?label=%40bbingz%2Fpolycli-opencode&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli-opencode)
[![npm: polycli-utils](https://img.shields.io/npm/v/@bbingz/polycli-utils?label=%40bbingz%2Fpolycli-utils&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli-utils)
[![npm: polycli-timing](https://img.shields.io/npm/v/@bbingz/polycli-timing?label=%40bbingz%2Fpolycli-timing&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli-timing)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

[English](./README.md) · [简体中文](./README.zh-CN.md) · **日本語**

</div>

---

## polycli とは？

`polycli` は、Claude Code・Codex・GitHub Copilot CLI・OpenCode のいずれかのホスト上で、共通のコマンド (`health`・`ask`・`review`・`rescue`・`timing`) を使って 9 種類の AI コーディング CLI — **`claude`**・**`gemini`**・**`kimi`**・**`qwen`**・**`copilot`**・**`opencode`**・**`pi`**・**`cmd`** (Command Code)・**`mini-agent`** (MiniMax) — を操作できるツールです。

これは **ユーティリティ専用の Path B モノレポ** です。プロバイダ間の差異を偽の抽象化で覆い隠したり、ランタイム基底クラスを発明したりはしません。公式の上流 CLI をサブプロセスとして組み合わせ、単一のコマンド面を公開し、4 状態の timing スキーマで能力の違いを正直に表現します。

## なぜ polycli を使うのか？

多くの「マルチ AI オーケストレーター」は、統一 API に合わせるため能力差について嘘をつきます。polycli は逆のアプローチを取ります:

- **正直な 4 状態 timing** — すべての指標は `measured`・`zero`・`missing`・`unsupported` のいずれかで、決して 1 つに丸められません。「測定不可」と「データなし」と「ゼロを出した」が常に区別されます。
- **偽の統一をしない** — プロバイダ間の差異 (session resume、ツールサポート、構造化出力) は capability matrix で明示し、グルーコードで隠しません。
- **CLI のパススルー** — 公式の上流 CLI (`gemini`・`kimi` など) を直接サブプロセスとして起動します。ローカルの既存認証と設定をそのまま使い、polycli が API キーを収集・アップロード・ホストすることはありません。
- **マルチホスト・単一の操作面** — Claude Code・Codex・Copilot CLI・OpenCode のどこでも同じコマンドが使えます。ホストを切り替えても学び直し不要です。

## ホストとプロバイダ

| ホスト (polycli のインストール先) | プロバイダ (polycli が呼び出せる対象) |
|---|---|
| Claude Code · Codex · GitHub Copilot CLI · OpenCode | `claude` · `copilot` · `gemini` · `kimi` · `qwen` · `opencode` · `pi` · `cmd` · `mini-agent` |

各プロバイダの対応能力は [Capability matrix](#capability-matrix) を参照してください。

## インストール

### Claude Code

```bash
claude plugin marketplace add bbingz/polycli
claude plugin install polycli@polycli-hosts
```

### Codex

```bash
codex plugin marketplace add bbingz/polycli
```

その後、新しい Codex TUI セッションで `/plugins` を開き、`polycli-hosts` marketplace から `Polycli` をインストールまたは有効化し、さらに新しいセッションを開始して skill 一覧を再構築します。

### GitHub Copilot CLI

```bash
copilot plugin marketplace add bbingz/polycli
copilot plugin install polycli-copilot@polycli-hosts
```

### OpenCode

```bash
opencode plugin @bbingz/polycli-opencode
```

## クイックスタート

インストール後、ホスト内で動作確認します:

> **polycli は in-host plugin であり、スタンドアロンの shell バイナリではありません。** `PATH` 上に `polycli` 実行ファイルは存在しません。各ホストアダプタが、そのホスト固有の呼び出し方法で同じ `health / ask / review / rescue / timing` ボキャブラリを公開します。サポート対象の 4 ホスト外（Aider / Cursor / 素のスクリプトなど）から使う場合は英語版 README の [Outside a supported host](./README.md#outside-a-supported-host) を参照してください。

```text
# Claude Code (slash command)
/polycli:health

# Codex (installed skill, not a slash command)
Choose Polycli with @, then ask it to run: health

# GitHub Copilot CLI (copilot prompt 内の skill ワード — **PATH バイナリではありません**)
polycli health

# OpenCode (tool 呼び出し — polycli_run を ["health","--json"] で呼び出す)
```

`health` は認証済みのすべてのプロバイダに対してエンドツーエンドのプローブを実行し、生きているものを `healthyProviders` に報告します。その後の日常利用は直接呼び出すだけです:

```text
Choose Polycli with @, then ask it to run: ask --provider qwen "このスタックトレースを説明して ..."
Choose Polycli with @, then ask it to run: review --provider claude --scope staged
Choose Polycli with @, then ask it to run: rescue --provider gemini --background "..."
```

長いタスクには `--background` を付け、`status <jobId>` / `result <jobId>` で結果を取得します。

## コアコマンド

すべてのコマンドはホストを問わず同じ動作をします:

| コマンド | 動作 |
|---|---|
| `setup` | プロバイダ CLI のインストール状態と認証状態を確認 (モデル呼び出しなし、軽量) |
| `health` | 短いプロンプトでエンドツーエンド検査。`healthyProviders` を返し、timing を記録 |
| `ask` | 一発のプロンプト |
| `review` | 現在の `git diff` に対するコードレビュー |
| `rescue` | 長めのトリアージ / 解析タスク |
| `adversarial-review` | 攻撃面寄りのレビュー |
| `timing` | timing の履歴と集計を確認 |
| `status` / `result` / `cancel` | バックグラウンドジョブの制御 |

`health` を実行するのは次の場合だけで構いません: (a) 初めてプロバイダを接続したとき、(b) 認証状態が変わったとき、(c) プロバイダコマンドが失敗したとき。日常利用では毎回前置きで実行する必要はありません。

## Capability matrix

正典: [`packages/polycli-runtime/src/registry.js`](./packages/polycli-runtime/src/registry.js) の `RUNTIMES` + `TIMING_SUPPORT`。`✓` = 対応。`—` = 設計上対応外 (timing では `unsupported` として報告され、`missing` や `0` に偽装しません)。

| Provider | streaming | sessionResume | structuredOutput | ttft | gen | tail | tool |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `claude` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `copilot` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `gemini` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `kimi` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `qwen` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `mini-agent` | ✓ | — | — | — | — | — | — |
| `opencode` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `pi` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `cmd` | ✓ | — | — | ✓ | ✓ | ✓ | — |

補足:

- `cold` と `retry` は全プロバイダで `unsupported` です。上流 CLI に安定したシグナルがなく、polycli は偽装を拒否します。`total` は常に `measured` です。
- `mini-agent` はログ再生方式で、session resume・構造化出力・細粒度 streaming timing をサポートしません。`cmd` は Command Code 公式の headless mode を使うため、各呼び出しは standalone session で、stdout が可視回答になります。
- `tool: true` を宣言しているのは `qwen` のみです。`qwen` がツールを呼び出さなかったとき `missing` (観測可能だが今回は発生せず) を、他のプロバイダは `unsupported` (能力レベルで追跡しない) を報告します。両者の意味は異なるため、混同しないでください。

## Timing のセマンティクス

polycli の timing 契約が統一するのは**状態の表現**であって、数値ではありません。各指標は次の 4 つの状態のいずれかを必ず持ちます:

| 状態 | 意味 |
|---|---|
| `measured` | 実測値、ゼロでない |
| `zero` | 明示的にゼロを寄与 |
| `missing` | 原理的には測定可能、今回は取得できず |
| `unsupported` | プロバイダ / ランタイムがそもそもこの指標を持たない |

これにより、プロバイダ間比較で「能力なし」「データなし」「ゼロを寄与」が同じ列に押し込まれることを防ぎます。

各 timing レコードには次のフィールドも含まれます:

- `runtimePersistence` — `ephemeral | session | daemon`
- `measurementScope` — `request | turn | job`

## パッケージ

| パッケージ | 役割 |
|---|---|
| [`@bbingz/polycli-utils`](./packages/polycli-utils) | 引数パース、プロセス実行、stream デコード、NDJSON、原子的保存、session-id、stream JSON パース |
| [`@bbingz/polycli-timing`](./packages/polycli-timing) | timing スキーマ、ランタイム検証、パーセンタイル、capability-aware 集計 |
| [`@bbingz/polycli-runtime`](./packages/polycli-runtime) | プロバイダレジストリ、可用性 / 認証プローブ、起動引数ビルダ、フォアグラウンド / streaming 実行、stream / log パース |

プラグイン配布物:

- [`plugins/polycli`](./plugins/polycli) — Claude Code 用ホストプラグイン
- [`plugins/polycli-codex`](./plugins/polycli-codex) — Codex
- [`plugins/polycli-copilot`](./plugins/polycli-copilot) — GitHub Copilot CLI
- [`plugins/polycli-opencode`](./plugins/polycli-opencode) — OpenCode

## 開発

要件: Node.js `>=20`。

```bash
npm install
npm test                                       # build:plugins + 全テスト
node --test packages/polycli-runtime/test/     # 単一パッケージのテスト
npm run build:plugins                          # プラグイン配布物の再ビルド
npm run release:check                          # リリース前チェック
```

`npm test` は内部で `build:plugins` を先に実行します。手動で先に build してから test を回す**必要はありません**。

## リリース

手順: [`docs/release.md`](./docs/release.md)。バージョンごとの release notes: [`docs/release-notes-*.md`](./docs/)。

## アーキテクチャと貢献

PR を送る前に必ず読んでください:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contribution workflow and release-facing checks
- [`AGENTS.md`](./AGENTS.md) — リポジトリマップ、編集ルール、提出基準
- [`CLAUDE.md`](./CLAUDE.md) — Claude Code 固有のパッチ
- [`docs/polycli-proposal.md`](./docs/polycli-proposal.md) — 主要なアーキテクチャ / プロダクトの背景
- [`docs/roadmap.md`](./docs/roadmap.md) — 進行中のタスクリスト

セキュリティ報告: [`SECURITY.md`](./SECURITY.md) を参照してください。

固いアーキテクチャ制約 (遵守してください):

- プロバイダ固有のプロトコル解析は `polycli-runtime` に置き、`polycli-utils` には**移動しない**こと。
- 4 状態 timing は折り畳み禁止。`cold` と `retry` は意図的に未実装 (上流 CLI に安定したシグナルがないため)。
- レガシー姉妹リポジトリ (`gemini-plugin-cc` / `qwen-plugin-cc` / `kimi-plugin-cc` / `minimax-plugin-cc`) は読み取り専用のリファレンスです。`grep` での参照は OK、編集は禁止。

## ライセンス

[MIT](./LICENSE) — [`LICENSE`](./LICENSE) および各パッケージの [`packages/*/package.json`](./packages/) を参照してください。
