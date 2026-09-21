# Solid Skill MT5 Read-Only Bridge

An MQL5 Expert Advisor that **observes** a MetaTrader 5 account and forwards
raw deal facts to the Solid Skill desktop app over a localhost TCP socket.

> **Read-only, always.** This EA never sends, modifies, or cancels an order,
> never opens or closes a position, never touches SL/TP/volume, and contains
> no trading code at all (no `OrderSend`, no `CTrade`, no `#include`, no
> DLLs). It never even reads from its socket, so nothing can instruct it.
> Solid Skill observes the account; it never controls it.

Design and contract: `docs/MT5_INTEGRATION_SPIKE.md`,
`docs/MT5_RAW_DEAL_CONTRACT.md`.

## Status — read this first

**Verified on a real MT5 terminal (Checkpoint 012 final QA).** After the
history-loop fix, `SolidSkillBridge.mq5` compiled in MetaEditor with 0 errors
and 0 warnings, attached with algorithmic trading disabled, connected
read-only to `127.0.0.1:47615`, and detected the real account as
`RETAIL_HEDGING`. History sync: discovered 55, sent 55, failed 0, all 55
received (55 new). A reconnect replayed the same 55 (0 new, 55 already
known), so replay and deduplication work on real data.

**Still unproven:** real live `OnTradeTransaction` delivery, and real netting
reversal `DEAL_POSITION_ID` behavior. Raw deals are staged in memory only; no
MT5 normalizer exists and nothing is written to Trade persistence. The EA has
no trading capability. Details: `docs/MT5_INTEGRATION_SPIKE.md` §10a and §15.

## Steps for the first real test (use a DEMO account)

1. **Start Solid Skill with the bridge enabled** (it is off by default):
   PowerShell, from the repo root:
   ```powershell
   $env:SOLID_SKILL_MT5_BRIDGE = "1"
   npm run dev
   ```
   Optional: `SOLID_SKILL_MT5_PORT` (default `47615`) and
   `SOLID_SKILL_MT5_BRIDGE_KEY` (then set the same value in the EA's
   `InpBridgeKey`). The console shows `[mt5] MT5 bridge listening on 127.0.0.1:47615`.
2. **Place the file.** In MT5: *File → Open Data Folder*, then copy
   `SolidSkillBridge.mq5` into `MQL5\Experts\` (a subfolder such as
   `MQL5\Experts\SolidSkill\` is fine).
3. **Open MetaEditor** (press **F4** in MT5, or the toolbar icon), open the
   file, and **compile** with **F7** (or *Compile*). Expect 0 errors. Refresh
   the Navigator in MT5 (right-click → Refresh) so the EA appears.
4. **Allow the local address.** MT5: *Tools → Options → Expert Advisors*, tick
   **Allow WebRequest for listed URL** (this same allow-list governs
   `SocketConnect`), and add `127.0.0.1` to the list. If the EA later reports
   it cannot connect while Solid Skill is running, also try adding
   `localhost`. "Allow DLL imports" is **not** needed and must stay off.
5. **Attach to one chart.** Drag `SolidSkillBridge` from the Navigator onto
   **any single chart** (the symbol/timeframe do not matter; attach it once
   per terminal). Leave inputs at defaults (`InpHost=127.0.0.1`,
   `InpPort=47615`) unless you changed the port.
6. **Algo Trading:** the EA only observes, so it should not need it. If the
   EA shows a "disabled" icon or logs nothing, enable the **Algo Trading**
   toolbar button and the EA's *Allow Algo Trading* option; this is safe
   because the EA contains no trading code. (Whether it is strictly required
   for `OnTradeTransaction`/`OnTimer` is unverified — please note what you
   observe.)
7. **Trigger a deal** on the demo account (e.g. a minimum-volume buy then
   close, done by you manually). The EA does not do this.

## What success looks like

MT5 → *Toolbox → Experts* tab:
```
[SolidSkill] Solid Skill MT5 Read-Only Bridge 1.0.0-spike started. This EA never trades.
[SolidSkill] Connected to Solid Skill at 127.0.0.1:47615 (read-only, account <login>)
[SolidSkill] History sync sent
```
Solid Skill console:
```
[mt5] MT5 bridge listening on 127.0.0.1:47615
[mt5] MT5 account hello received (***123, RETAIL_HEDGING)
[mt5] MT5 history sync started (***123)
[mt5] MT5 history sync COMPLETE (***123): discovered N, EA sent N, EA failed 0, received N; N new, 0 already known
```
Stop and restart Solid Skill while the EA stays attached: the EA reconnects
(backoff up to 30 s) and a second sync reports the same deals as
`already known` (`0 new, N already known`).

Not reachable (Solid Skill not running) logs once:
`[SolidSkill] Solid Skill not reachable at 127.0.0.1:47615 (error …). Will keep retrying.`
That is normal and harmless.

## Notes and limits

- Same machine only. A terminal on a remote VPS cannot reach this PC's
  loopback. Not available in the Strategy Tester.
- The EA sends account metadata (login, server, company, currency, margin
  mode, terminal build) and raw deals. **Never** passwords, investor
  passwords, or tokens. The deal comment is not sent.
- Raw deals are held in memory only in this spike; nothing appears in the
  Journal yet by design.
- Fixtures and the fake sender used by `npm run smoke:mt5` live in
  `src/main/integrations/mt5/__smoke__/`.
