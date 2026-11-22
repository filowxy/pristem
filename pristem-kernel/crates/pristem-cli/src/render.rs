//! ANSI/ESC rendering. The CLI is a thin client: IO and drawing only, zero kernel
//! capability. Buttons are OSC 8 hyperlinks (mouse-clickable in modern terminals) with a
//! numbered keyboard fallback, inspired by Grok Build CLI + Cline `[TA]`.

use pristem_ipc::ServerEvent;

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const CYAN: &str = "\x1b[36m";
const YELLOW: &str = "\x1b[33m";
const RED: &str = "\x1b[31m";
const GREEN: &str = "\x1b[32m";

pub struct Renderer {
    pub ansi: bool,
}

impl Renderer {
    fn paint(&self, code: &str, text: &str) -> String {
        if self.ansi {
            format!("{code}{text}{RESET}")
        } else {
            text.to_string()
        }
    }

    pub fn banner(&self, protocol: &str, sigdb: &str, modes: &[String]) -> String {
        let mut out = String::new();
        out.push_str(&self.paint(BOLD, "pristem"));
        out.push_str(&self.paint(DIM, &format!("  {protocol}  sigdb {sigdb}")));
        out.push('\n');
        out.push_str(&self.paint(
            DIM,
            &format!("modes: {}   (thin CLI client)\n", modes.join(" / ")),
        ));
        out
    }

    pub fn event(&self, ev: &ServerEvent) -> String {
        match ev {
            ServerEvent::SessionOpened { session, mode } => {
                self.paint(DIM, &format!("[session {session} opened: {mode}]\n"))
            }
            ServerEvent::SessionClosed { session } => {
                self.paint(DIM, &format!("[session {session} closed]\n"))
            }
            ServerEvent::ModeChanged { from, to, .. } => {
                self.paint(CYAN, &format!("[mode {from} -> {to}]\n"))
            }
            ServerEvent::Speech { text, .. } => format!("{text}\n"),
            // Streamed fragment: printed verbatim, no newline, so the text grows in place.
            ServerEvent::SpeechDelta { text, .. } => text.clone(),
            ServerEvent::Call { tool, verdict, .. } => {
                self.paint(DIM, &format!("  [call] {tool} ({verdict})\n"))
            }
            ServerEvent::Result {
                tool,
                status,
                output,
                ..
            } => {
                let colour = if status == "ok" || status == "rerouted" {
                    GREEN
                } else {
                    YELLOW
                };
                let mut s = self.paint(colour, &format!("  [result:{status}] {tool}\n"));
                if !output.trim().is_empty() {
                    for line in output.lines().take(20) {
                        s.push_str(&self.paint(DIM, &format!("    {line}\n")));
                    }
                }
                s
            }
            ServerEvent::Answer { text, .. } => {
                format!("{}{text}\n", self.paint(BOLD, "pristem › "))
            }
            ServerEvent::Intercepted {
                sig_ids, position, ..
            } => self.paint(
                YELLOW,
                &format!("[intercepted at {position}: {}]\n", sig_ids.join(", ")),
            ),
            ServerEvent::MissingReminder { lines, reject, .. } => self.paint(
                RED,
                &format!(
                    "[answer-gate: {}] missing lines: {}\n",
                    if *reject { "hard reject" } else { "warning" },
                    lines.join(" | ")
                ),
            ),
            ServerEvent::DigestRequested { reason, .. } => {
                self.paint(CYAN, &format!("[deepsleep digestion requested] {reason}\n"))
            }
            ServerEvent::Reminder { lines, .. } => {
                let mut s = self.paint(BOLD, "[REMINDER]\n");
                for l in lines {
                    s.push_str(&format!("  {l}\n"));
                }
                s
            }
            ServerEvent::Buttons {
                session,
                prompt,
                buttons,
            } => self.buttons(*session, prompt, buttons),
            ServerEvent::Finished { outcome, .. } => {
                self.paint(DIM, &format!("[round finished: {outcome}]\n"))
            }
            ServerEvent::Usage {
                input_tokens,
                output_tokens,
                cached_tokens,
                elapsed_ms,
                tool_calls,
                ..
            } => self.paint(
                DIM,
                &format!(
                    "[usage] input {input_tokens}  output {output_tokens}  cached {cached_tokens}  calls {tool_calls}  elapsed {elapsed_ms} ms\n"
                ),
            ),
            ServerEvent::ProviderChanged {
                provider, model, ..
            } => self.paint(CYAN, &format!("[provider {provider} model {model}]\n")),
            ServerEvent::Providers { providers } => {
                let mut s = self.paint(BOLD, "[providers]\n");
                for p in providers {
                    s.push_str(&format!(
                        "  {}{}  {} model {} key {} ({})\n",
                        if p.is_default { "* " } else { "  " },
                        p.id,
                        p.adapter,
                        p.model,
                        if p.key_present { "present" } else { "MISSING" },
                        p.api_key_env,
                    ));
                }
                s
            }
            ServerEvent::Error { message, .. } => self.paint(RED, &format!("[error] {message}\n")),
        }
    }

    /// OSC 8 clickable button + a numbered keyboard fallback.
    pub fn buttons(
        &self,
        session: u64,
        prompt: &str,
        buttons: &[pristem_ipc::ButtonSpec],
    ) -> String {
        let mut out = self.paint(BOLD, &format!("{prompt}\n"));
        for (i, b) in buttons.iter().enumerate() {
            let label = if self.ansi {
                format!(
                    "\x1b]8;;{}\x1b\\[{}] {}\x1b]8;;\x1b\\",
                    b.uri,
                    i + 1,
                    b.label
                )
            } else {
                format!("[{}] {}", i + 1, b.label)
            };
            out.push_str(&format!("  {label}\n"));
        }
        out.push_str(&self.paint(
            DIM,
            &format!(
                "  (type 1-{} then Enter, or send Confirm for session {session})\n",
                buttons.len()
            ),
        ));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pristem_ipc::ButtonSpec;

    #[test]
    fn buttons_are_osc8_clickable_with_a_keyboard_fallback() {
        let r = Renderer { ansi: true };
        let out = r.buttons(
            3,
            "Release?",
            &[ButtonSpec::new(7, 3, "Release item", "release")],
        );
        assert!(out.contains("\x1b]8;;pristem://confirm/3/7/release\x1b\\"));
        assert!(out.contains("[1] Release item"));
    }

    #[test]
    fn no_ansi_mode_is_plain_text() {
        let r = Renderer { ansi: false };
        let out = r.event(&ServerEvent::Answer {
            session: 1,
            text: "ok".into(),
        });
        assert_eq!(out, "pristem › ok\n");
        assert!(!out.contains('\x1b'));
    }

    #[test]
    fn errors_and_interceptions_are_visually_distinct() {
        let r = Renderer { ansi: true };
        assert!(r
            .event(&ServerEvent::Error {
                session: 0,
                message: "x".into()
            })
            .contains(RED));
        assert!(r
            .event(&ServerEvent::Intercepted {
                session: 1,
                sig_ids: vec!["JB-001".into()],
                position: "inbound".into()
            })
            .contains(YELLOW));
    }
}
