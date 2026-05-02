# Multi-way validation — 2026-05-02

End-to-end validation across all 8 polycli providers using **real** benchmark prompts (not benchmark-flavored re-creations) pulled verbatim from HuggingFace dataset rows. Run as part of debug session that produced the gemini timeout multiplier (commit history 2026-05-02).

Codex was added as a 9th reference entity via the `codex:codex-rescue` subagent invoking `codex exec --skip-git-repo-check` directly (see session memory `a48de540074220012` for the codex 5-round transcript).

## Round 1 — easy first-row probes (40/40 PASS)

Sanity-check that every provider reaches every benchmark family. Wall time 113s for 5 rounds × 8 providers (parallel within round, sequential across rounds).

| Round | Source | Question | Ground truth |
|---|---|---|---|
| R1 | `cais/mmlu` config=`all` test offset=0 | Q(√2,√3,√18)/Q field extension degree | `B` (= 4) |
| R2 | `openai/gsm8k` config=`main` test offset=0 | Janet's ducks: 16 - 3 - 4 = 9 eggs × $2 | `18` |
| R3 | `openai/openai_humaneval` test offset=2 (`HumanEval/2`) | `truncate_number` | `return number % 1.0` |
| R4 | `truthfulqa/truthful_qa` config=`generation` validation offset=5 | Why matadors wave red capes | tradition / movement / blood-masking; bulls colorblind |
| R5 | `lukaemon/bbh` config=`logical_deduction_three_objects` test offset=0 | Quail / blue jay / falcon order | `(A)` blue jay second from left |

All 8 providers (claude, copilot, opencode, pi, gemini, kimi, qwen, minimax) plus codex returned correct answers on all 5 prompts. **No timeouts, no routing errors, no model-id null**.

## Round 2 — hard prompts with discrimination (37/40 PASS)

Hand-picked harder offsets to discriminate between providers.

| Round | Source | Question | Ground truth |
|---|---|---|---|
| R1 | `cais/mmlu` config=`college_mathematics` test offset=5 | Subset of Z₁₀ closed/identity statements | `D` (false: S has mult identity = 6) |
| R2 | `openai/gsm8k` config=`main` test offset=1000 | Doctor Jones time budget | `1` hour |
| R3 | `openai/openai_humaneval` test offset=130 (`HumanEval/130`) | Tribonacci with forward-reference recurrence | unit test must pass |
| R4 | `truthfulqa/truthful_qa` config=`generation` validation offset=400 | What did SOS originally stand for? | nothing (Morse simplicity) |
| R5 | `lukaemon/bbh` config=`tracking_shuffled_objects_seven_objects` test offset=0 | 7-player position swap trace | `(A)` striker |

### Result matrix (after grader bug fixes — see "Grader lessons" below)

| Provider | R1 alg | R2 doc | R3 Tri | R4 SOS | R5 7obj | Score | Model |
|---|---|---|---|---|---|---|---|
| claude | ✅ | ✅ | ✅ | ✅ | ✅ | 5/5 | claude-opus-4-7[1m] |
| copilot | ✅ | ✅ | ✅ | ✅ | ✅ | 5/5 | gpt-5.4 |
| pi | ✅ | ✅ | ✅ | ✅ | ✅ | 5/5 | openai-codex/gpt-5.4 |
| gemini | ✅ | ✅ | ✅ | ✅ | ✅ | 5/5 | gemini-3.1-pro-preview |
| qwen | ✅ | ✅ | ✅ | ✅ | ✅ | 5/5 | qwen3.6-plus |
| kimi | ✅ | ❌ | ❌ | ✅ | ✅ | 3/5 | kimi-code/kimi-for-coding |
| minimax | ✅ | ✅ | ❌ | ✅ | ✅ | 4/5 | MiniMax-M2.7-highspeed |
| **opencode** | ✅ | ✅ | **❌ TIMEOUT** | ✅ | ✅ | 4/5 | kimi-for-coding/k2p6 |

### Failure analysis

1. **kimi R2** — answered `9` (the inpatient count) instead of `1` (hours remaining). Misread the prompt. LLM-side, not polycli.
2. **kimi R3** — emitted reasoning prose ("Wait, let me look at the examples more carefully...") instead of the function body the prompt explicitly required. Instruction-following weakness, not polycli.
3. **minimax R3** — emitted clean code body but `tri(2)` returned `[0, 3, 2]` instead of `[1, 3, 2.0]`, and the forward-reference logic broke at `result[i+1]`. Reasoning bug, not polycli.
4. **opencode R3** — `timedOut: true, signal: "SIGTERM"`, total 120021 ms. Hit the 120s `ask` ceiling exactly. **This was the polycli finding** — the `kimi-for-coding/k2p6` opencode model is also a code-reasoning model, and HumanEval/130 (Tribonacci with awkward forward-reference recurrence) pushed it past 120s. Fixed by adding opencode to `PROVIDER_TIMEOUT_MULTIPLIERS` (commit history 2026-05-02).

### Per-round latency snapshot (ms / 1000 = seconds)

| | R1 | R2 | R3 (Tri) | R4 | R5 |
|---|---|---|---|---|---|
| claude | 11s | 7s | 8s | 9s | 10s |
| copilot | 17s | 14s | 18s | 15s | 16s |
| opencode | 25s | 11s | **120s ⚠️** | 15s | 26s |
| pi | 14s | 11s | 16s | 8s | 10s |
| gemini | 27s | 23s | 46s | 24s | 33s |
| kimi | 7s | 5s | 73s | 6s | 10s |
| qwen | 11s | 6s | 21s | 7s | 12s |
| minimax | 46s | 7s | 30s | 7s | 9s |

R3 is the universal long-pole — every provider's reasoning time spikes on Tribonacci. Gemini gets 46s (with the 240s ceiling, ample room); opencode hits the wall.

## Grader lessons (DO NOT REPEAT)

Three grader bugs were caught after the first scoring pass. Future benchmark scripts should avoid these:

### 1. `.strip()` eats leading indent on Python function bodies

```python
# WRONG — strips the 4-space leading indent that makes the body valid
body = re.sub(r'```python\n?', '', resp).replace('```', '').strip()
full = f"def tri(n):\n{body}\n"  # IndentationError on line 2
```

```python
# RIGHT — only trim trailing whitespace; lstrip newlines explicitly
body = re.sub(r'```python\n?', '', resp).replace('```', '')
body = body.lstrip('\n').rstrip()
# If body has no leading whitespace, indent it
first_real = next((l for l in body.split('\n') if l.strip()), '')
if first_real and not first_real.startswith((' ', '\t')):
    body = '\n'.join('    ' + l if l.strip() else l for l in body.split('\n'))
```

### 2. Negation detection on prefix only is too narrow

```python
# WRONG — captures only 30 chars before the suspect phrase, misses "not because" later
m = re.search(r'(.{0,30})(bulls?)[^.]{0,40}(angered).*\bred\b', low)
if 'not' in m.group(1):  # FALSE — only checks tiny prefix
    pass
```

This false-failed kimi's TruthfulQA answer "...attracts and confuses the bull, **not because** bulls are angered by red" — the "not because" landed between the captured `bull` and the suspect `bulls...angered...red` phrase, outside the prefix capture.

```python
# RIGHT — check the entire sentence for negation markers
NEGATIONS = ['not because','rather than','contrary to','myth','misconception',
             'actually','colorblind','color-blind']
has_myth = bool(re.search(r'(bulls?|they)[^.]{0,80}(angered|enraged)[^.]{0,40}\bred\b', low))
has_neg = any(n in low for n in NEGATIONS)
if has_myth and not has_neg: return ('FAIL', ...)
```

### 3. Single-language regex misses correct answers in other languages

Claude's TruthfulQA answer was Chinese ("斗牛士挥红色斗篷其实并非为了激怒公牛——公牛是色盲...") because the user's global `CLAUDE.md` says "Always respond in Chinese". The original grader only matched English keywords (`tradition`, `movement`, `blood`) and reported `?`.

```python
# RIGHT — include CJK keyword set
correct_en = any(s in low for s in ['tradition','movement','blood','colorblind'])
correct_zh = any(s in resp for s in ['色盲','动作','挥动','血迹','传统'])
correct = correct_en or correct_zh
```

## Provider behavior notes (LLM-side, no polycli action needed)

These are informational — recorded so future investigators do not re-derive them.

- **kimi**: terse on simple short prompts (5-10s, often single-token answers). Tends to **skip instructions** when the prompt is hard — emits reasoning monologue instead of the requested format. Misreads multi-step word problems (R2 GSM8K Doctor Jones). Best for short prompts; less reliable on instruction-following under load.
- **minimax**: stays terse and on-format even on hard prompts (the only provider that gave a clean one-line `has_close_elements` body in round 1 round 3). But **reasoning depth is shallow** — botched Tribonacci's forward-reference recurrence. Good for format-strict short tasks; weak for puzzle-class reasoning.
- **opencode** (model `kimi-for-coding/k2p6`): code-reasoning specialist; behaves like gemini reasoning model on latency (slow, > 60s on hard code). The added timeout multiplier compensates.
- **gemini** (`gemini-3.1-pro-preview`): the canonical deep-reasoning provider. Routinely 30-77s on benchmark prompts. The ×2 multiplier was originally added for it; in practice peaks observed in this session were under 80s, well below the 240s ceiling — multiplier is defensive headroom for the worst case.
- **claude / copilot / pi / qwen**: reliable across the board on benchmark difficulty in this session. No category-specific issues observed.

## Reproducibility

The exact dataset offsets and prompt strings are in this document. To re-run:

```bash
# Pull dataset rows via HuggingFace dataset viewer:
curl -s "https://datasets-server.huggingface.co/rows?dataset=cais%2Fmmlu&config=college_mathematics&split=test&offset=5&length=1"
# (similarly for the other four sources — exact URLs above)

# Then for each prompt, foreach provider:
node plugins/polycli/scripts/polycli-companion.bundle.mjs ask --provider <name> --json "<prompt>"
```

GPQA-Diamond was attempted as a 5th harder source but is gated on HuggingFace (401 without auth token); BBH `tracking_shuffled_objects_seven_objects` was used instead.

## What this run did NOT prove

- Statistical performance — N=1 per cell, single snapshot, no error bars.
- Coverage of full benchmark — only 1 row sampled per benchmark (per round), not the 8500/164/817 rows each contains.
- Safety / refusal behavior — none of the 10 prompts had a refusal trigger.
- Tool use — all prompts were closed-form Q&A; tool-using behavior is covered separately by `capability-matrix.md`.

The point of this run was **integration sanity** (every provider reaches every benchmark family + the routing layer doesn't corrupt outputs), not a leaderboard.
