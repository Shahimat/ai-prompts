---
key: ticket-commits
kind: module
applicable_to: [agent-operational-contract-v3]
patterns: [source-sync]
title: Модуль ticket-commits — устарел
deprecated: глобальные правила пользователя
use_case: Устарел. Правила тикетов и коммитов живут в глобальных инструкциях пользователя (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md), а не в проекте и не в контракте. Ключ сохранён, чтобы обновление из источника в проектах с этим модулем предложило его отключить.
tags: [workflow, commits, agent-contract, module, deprecated]
---

# Модуль ticket-commits — устарел

Правила тикетов и коммитов — как нарезать работу на коммиты, когда
останавливаться, какое сообщение писать — живут в глобальных
инструкциях пользователя (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`).
Копия в контракте расходилась с ними, поэтому модуль упразднён.

Правило ядра «git-запись делает пользователь» остаётся в `AGENTS.md`.

## Если модуль подключён в проекте

Отключи его по `provides` манифеста `context/modules/ticket-commits.yml`:

1. Удали skill `.agents/skills/ticket-commits/` и его копии адаптеров.
2. Удали блок `<!-- module:ticket-commits -->` из `AGENTS.md`.
3. Удали манифест `context/modules/ticket-commits.yml`.

План — пользователю, удаление — после явного «да».
