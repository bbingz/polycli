# polycli v0.6.31

[English](./release-notes-v0.6.31.md) · [简体中文](./release-notes-v0.6.31.zh-CN.md) · **日本語**

`v0.6.30` を基にした review-remediation パッチです。リリース後の包括的な review で確認された問題をすべて解消しながら、Path B の境界を維持しています。provider adapter は引き続きフラットかつ明示的で、runtime package は private のままです。provider protocol framework も導入していません。

## 変更内容

### 正確な CLI と観測契約

- 変更のない background review は、実在しない job の合成 `job.started` レコードではなく、実際の skipped result を返すようになりました。
- `setup` と `health` は、provider・認証・state にアクセスする前に、位置引数と flag で provider を重複指定する曖昧な呼び出しを拒否します。
- TUI の agent-context effects は local recovery-state write を明示するようになりました。デフォルトの status は terminal history を制限しつつ、すべての active job を表示します。
- 永続化される ledger preview は、すべて storage boundary でサニタイズされます。

### 上限付き provider 実行と安全な prompt transport

- POSIX では、timeout・abort・decoder overflow・termination failure・`close` 欠落の各経路が provider process group を終了または強制終了し、canonical typed error で一度だけ完了します。Windows の streaming 経路は direct-child termination fallback を維持します。
- stdout と stderr の集約 capture にはそれぞれ独立した上限があり、診断用の総 byte count は保持されます。
- Claude と Gemini は、長大な prompt を検証済みの stdin transport に移します。argv-only provider は危険な長さの command line を spawn 前に拒否し、対処方法を含む typed `argument_list_too_long` error を返します。呼び出し側が明示的に `--max-diff-bytes` を選択しない限り、review input は引き続き無制限です。
- Claude・Copilot・OpenCode・Qwen は、回答本文中の任意の UUID を provider session identity として採用しなくなりました。

### 回復可能な background lifecycle

- Cancel は non-terminal intent を永続化し、worker identity が検証され worker が停止した後にのみ `cancelled` を公開します。
- SessionEnd は、state/ledger lock・process identity probe・Windows `taskkill` call も制限する単一 deadline の下で、authoritative cancel path に処理を委譲します。
- Config・log・open・spawn failure は private recovery sidecar を使用するため、envelope 生成前の一時的な失敗が pid のない queued job を永久に残すことはありません。
- Worker・cancel・terminal-ledger の race でも完全な terminal pair は 1 組だけ保持され、terminal state が観測可能になる前に、所有する runtime・config・recovery artifact を削除します。

### 再現可能な生成 artifact

- `validate:bundles` は esbuild `write:false` で source から expected bundle と terminal metadata を生成し、既存ファイルを上書きせず、すべての tracked artifact を byte-for-byte で比較します。
- GitHub CI と `release:check` は、`npm test` が in-place build を行う前にこの freshness gate を実行します。
- Source を変更しながら 5 個の tracked bundle を相互に同一のままにする regression test を追加し、pre-build validator が stale artifact を拒否することを証明しました。

## 互換性

- 既存の public `--json` payload は互換性を維持し、JSON v2 は引き続き opt-in です。
- Review collection はデフォルトで無制限です。`--max-diff-bytes` を明示した場合のみ input を切り詰めます。
- `@bbingz/polycli-runtime` は private のままで、provider module は引き続きフラットです。
- Host plugin・OpenCode・terminal CLI は `0.6.31`、`@bbingz/polycli-utils` は `1.0.5` に更新され、`@bbingz/polycli-timing` は `1.0.2` のままです。

## 検証

- 5 つの scoped implementation group は、それぞれ独立した spec-compliance review と code-quality review に合格しました。
- 最終 whole-branch review は 14 件の finding をすべて裁定した後、`Spec Compliance: PASS`・`Code Quality: APPROVED`・`Release Readiness: READY` を返しました。
- Local full suite は 906 tests 中 906 passed、0 failed でした。
- `npm run release:check` は source-derived bundle freshness・strict fixture freshness・manifest・host map・Codex guidance・installed CLI review flag drift・2 件の Claude plugin validation・全 npm package dry-run を通過しました。
- 当時 native Windows execution は利用できませんでした。Windows argv budgeting と `taskkill`/deadline branch は deterministic simulation でカバーし、POSIX process-group と live process-tree behavior のみ native execution で検証しました。
- PR #16 CI と merge 後の main CI はいずれも成功しました。Clean registry install では provider を呼び出さずに terminal `agent-context --json`（schema 1、build `0.6.31`、20 commands、resolved utils `1.0.5`）を実行し、OpenCode package の import に成功しました。

## リリース artifact

- GitHub release: `v0.6.31` — tag commit `a70eb093bc7892e2f6b653ed29ca8bba5d66489b`、公開日時 `2026-07-15T14:39:17Z`
- npm: `@bbingz/polycli@0.6.31` — `57d0f77811767c4310623af03f27af82375abae8`
- npm: `@bbingz/polycli-opencode@0.6.31` — `65c990f89df099bb0a1a95104a0a8400abb0f6ca`
- npm: `@bbingz/polycli-utils@1.0.5` — `99df508a6bffe601e79569927bedf4016d3d471f`
- 変更なしの npm package: `@bbingz/polycli-timing@1.0.2`
