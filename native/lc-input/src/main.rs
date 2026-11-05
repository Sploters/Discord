//! lc-input — injeta o mouse e o teclado do controle remoto da Resenha (Windows).
//! Iniciado pelo app desktop, conversa só pela entrada/saída padrão (nenhuma porta de rede).
//! Segurança:
//!  - só injeta "armado" (o app arma depois que o dono aceitou no próprio PC) e só dentro do monitor transmitido;
//!  - atalho de emergência Ctrl+Alt+Shift+Q lido por um gancho de teclado de baixo nível que IGNORA entrada injetada:
//!    só o teclado físico do dono dispara (quem controla não consegue desligar o atalho nem apertá-lo);
//!  - ao desarmar, no atalho, ou se o app fechar (fim da entrada padrão), solta toda tecla/botão que ficou pressionado.
//! Saída padrão: {"t":"ready"}, {"t":"armed"}, {"t":"disarmed"}, {"t":"panic"}, {"t":"err","msg":...}
mod keymap;
mod proto;

use std::io::Write;

fn emit(s: &str) { let mut o = std::io::stdout().lock(); let _ = writeln!(o, "{s}"); let _ = o.flush(); }

#[cfg(not(windows))]
fn main() {
    // fora do Windows só valida o protocolo (útil para testes): ecoa quantos eventos seriam injetados
    emit(r#"{"t":"ready","native":false}"#);
    use std::io::BufRead;
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        match proto::parse(&line) {
            proto::Cmd::Events(v) => emit(&format!(r#"{{"t":"dry","n":{}}}"#, v.len())),
            proto::Cmd::Bad => emit(r#"{"t":"err","msg":"comando inválido"}"#),
            _ => {}
        }
    }
}

#[cfg(windows)]
fn main() { win::run(); }

#[cfg(windows)]
mod win {
    use super::{emit, proto};
    use proto::{Action, Cmd, Rect};
    use std::io::BufRead;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    struct State { armed: bool, rect: Option<Rect>, keys: Vec<(u16, bool)>, buttons: [bool; 3] }
    static STATE: Mutex<State> = Mutex::new(State { armed: false, rect: None, keys: Vec::new(), buttons: [false; 3] });
    static PHYS_CTRL: AtomicBool = AtomicBool::new(false);
    static PHYS_ALT: AtomicBool = AtomicBool::new(false);
    static PHYS_SHIFT: AtomicBool = AtomicBool::new(false);

    fn send(inputs: &[INPUT]) -> bool { unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) as usize == inputs.len() } }
    fn mouse(dx: i32, dy: i32, data: i32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
        INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dx, dy, mouseData: data as _, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }
    }
    fn key(scan: u16, ext: bool, down: bool) -> INPUT {
        let mut f = KEYEVENTF_SCANCODE; if ext { f |= KEYEVENTF_EXTENDEDKEY; } if !down { f |= KEYEVENTF_KEYUP; }
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: scan, dwFlags: f, time: 0, dwExtraInfo: 0 } } }
    }
    const BTN: [(MOUSE_EVENT_FLAGS, MOUSE_EVENT_FLAGS); 3] = [(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP), (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP), (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)];

    /// solta tudo o que a sessão deixou pressionado
    fn release_all(st: &mut State) {
        let mut v: Vec<INPUT> = st.keys.drain(..).map(|(s, e)| key(s, e, false)).collect();
        for (i, down) in st.buttons.iter_mut().enumerate() { if *down { v.push(mouse(0, 0, 0, BTN[i].1)); *down = false; } }
        if !v.is_empty() { send(&v); }
    }
    fn disarm(st: &mut State) { release_all(st); st.armed = false; st.rect = None; }

    fn apply(st: &mut State, a: Action) -> bool {
        match a {
            Action::MoveTo { x, y } => {
                // coordenada absoluta na área de trabalho virtual (todos os monitores), escala 0..65535
                let (vx, vy, vw, vh) = unsafe { (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN), GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN)) };
                if vw < 2 || vh < 2 { return false; }
                let nx = (((x - vx) as i64 * 65535) / (vw as i64 - 1)) as i32;
                let ny = (((y - vy) as i64 * 65535) / (vh as i64 - 1)) as i32;
                send(&[mouse(nx, ny, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK)])
            }
            Action::Button { b, down } => {
                let i = b as usize; if st.buttons[i] == down { return true; }
                st.buttons[i] = down; send(&[mouse(0, 0, 0, if down { BTN[i].0 } else { BTN[i].1 })])
            }
            Action::Wheel { dx, dy } => {
                let mut v = vec![]; if dy != 0 { v.push(mouse(0, 0, -dy, MOUSEEVENTF_WHEEL)); } if dx != 0 { v.push(mouse(0, 0, dx, MOUSEEVENTF_HWHEEL)); }
                send(&v)
            }
            Action::Key { scan, ext, down } => {
                if down { if !st.keys.contains(&(scan, ext)) { st.keys.push((scan, ext)); } } else if let Some(i) = st.keys.iter().position(|k| *k == (scan, ext)) { st.keys.swap_remove(i); } else { return true; } // não solta o que não apertou
                send(&[key(scan, ext, down)])
            }
        }
    }

    // gancho de teclado: só eventos físicos (sem LLKHF_INJECTED) contam para o atalho de emergência
    unsafe extern "system" fn kb_hook(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let k = &*(lp.0 as *const KBDLLHOOKSTRUCT);
            if (k.flags.0 & LLKHF_INJECTED.0) == 0 {
                let down = matches!(wp.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
                match VIRTUAL_KEY(k.vkCode as u16) {
                    VK_LCONTROL | VK_RCONTROL | VK_CONTROL => PHYS_CTRL.store(down, Ordering::SeqCst),
                    VK_LMENU | VK_RMENU | VK_MENU => PHYS_ALT.store(down, Ordering::SeqCst),
                    VK_LSHIFT | VK_RSHIFT | VK_SHIFT => PHYS_SHIFT.store(down, Ordering::SeqCst),
                    VIRTUAL_KEY(0x51) if down && PHYS_CTRL.load(Ordering::SeqCst) && PHYS_ALT.load(Ordering::SeqCst) && PHYS_SHIFT.load(Ordering::SeqCst) => {
                        // fora do gancho (não injeta de dentro do callback)
                        std::thread::spawn(|| { let mut st = STATE.lock().unwrap(); let was = st.armed; disarm(&mut st); drop(st); if was { emit(r#"{"t":"panic"}"#); } });
                    }
                    _ => {}
                }
            }
        }
        CallNextHookEx(None, code, wp, lp)
    }

    pub fn run() {
        unsafe { let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); } // pixels físicos de verdade
        std::thread::spawn(|| unsafe {
            let hmod = GetModuleHandleW(None).ok();
            match SetWindowsHookExW(WH_KEYBOARD_LL, Some(kb_hook), hmod.map(|h| h.into()), 0) {
                Ok(_) => { let mut msg = MSG::default(); while GetMessageW(&mut msg, None, 0, 0).as_bool() {} }
                Err(e) => emit(&format!(r#"{{"t":"err","msg":"atalho de emergência indisponível: {}"}}"#, e.message().replace('"', "'"))),
            }
        });
        emit(r#"{"t":"ready","native":true,"panic":"Ctrl+Alt+Shift+Q"}"#);
        let mut blocked_warned = false;
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            let mut st = STATE.lock().unwrap();
            match proto::parse(&line) {
                Cmd::Arm(r) => { st.armed = true; st.rect = Some(r); drop(st); emit(r#"{"t":"armed"}"#); }
                Cmd::Disarm => { disarm(&mut st); drop(st); emit(r#"{"t":"disarmed"}"#); }
                Cmd::Events(v) => {
                    let Some(r) = st.rect.filter(|_| st.armed) else { continue };
                    let mut ok = true;
                    for raw in v { ok &= apply(&mut st, proto::place(raw, r)); }
                    // SendInput falha quando a janela em foco é de administrador (UIPI): avisa uma vez
                    if !ok && !blocked_warned { blocked_warned = true; drop(st); emit(r#"{"t":"err","msg":"blocked"}"#); }
                }
                Cmd::Bad => { drop(st); emit(r#"{"t":"err","msg":"comando inválido"}"#); }
            }
        }
        // o app fechou: nunca deixa tecla presa
        disarm(&mut STATE.lock().unwrap());
    }
}
