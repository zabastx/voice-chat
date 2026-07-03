# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker (GitHub Issues in `zabastx/voice-chat`).

| Label in setup-matt-pocock-skills | Label in our tracker | Meaning                                  |
| --------------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`                    | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`                      | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`                 | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`                 | `ready-for-human`    | Requires human implementation            |
| `wontfix`                         | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table. This repo uses the identity mapping — no custom label names. If the repo later adopts a different vocabulary (e.g. `bug:triage` instead of `needs-triage`), edit the right-hand column to match and the skills will apply the right labels instead of creating duplicates.
