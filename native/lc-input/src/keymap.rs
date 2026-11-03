//! KeyboardEvent.code (posição física da tecla, independe do layout) -> scancode do Windows (conjunto 1).
//! Usar scancode faz a tecla sair igual à do teclado físico do dono, inclusive no ABNT2 (Ç, /?).

/// (scancode, estendida)
pub fn scan_for(code: &str) -> Option<(u16, bool)> {
    let s = |v: u16| Some((v, false));
    let e = |v: u16| Some((v, true));
    match code {
        "Escape" => s(0x01),
        "Digit1" => s(0x02), "Digit2" => s(0x03), "Digit3" => s(0x04), "Digit4" => s(0x05), "Digit5" => s(0x06),
        "Digit6" => s(0x07), "Digit7" => s(0x08), "Digit8" => s(0x09), "Digit9" => s(0x0A), "Digit0" => s(0x0B),
        "Minus" => s(0x0C), "Equal" => s(0x0D), "Backspace" => s(0x0E), "Tab" => s(0x0F),
        "KeyQ" => s(0x10), "KeyW" => s(0x11), "KeyE" => s(0x12), "KeyR" => s(0x13), "KeyT" => s(0x14),
        "KeyY" => s(0x15), "KeyU" => s(0x16), "KeyI" => s(0x17), "KeyO" => s(0x18), "KeyP" => s(0x19),
        "BracketLeft" => s(0x1A), "BracketRight" => s(0x1B), "Enter" => s(0x1C), "ControlLeft" => s(0x1D),
        "KeyA" => s(0x1E), "KeyS" => s(0x1F), "KeyD" => s(0x20), "KeyF" => s(0x21), "KeyG" => s(0x22),
        "KeyH" => s(0x23), "KeyJ" => s(0x24), "KeyK" => s(0x25), "KeyL" => s(0x26),
        "Semicolon" => s(0x27), "Quote" => s(0x28), "Backquote" => s(0x29), "ShiftLeft" => s(0x2A), "Backslash" => s(0x2B),
        "KeyZ" => s(0x2C), "KeyX" => s(0x2D), "KeyC" => s(0x2E), "KeyV" => s(0x2F), "KeyB" => s(0x30),
        "KeyN" => s(0x31), "KeyM" => s(0x32), "Comma" => s(0x33), "Period" => s(0x34), "Slash" => s(0x35),
        "ShiftRight" => s(0x36), "NumpadMultiply" => s(0x37), "AltLeft" => s(0x38), "Space" => s(0x39), "CapsLock" => s(0x3A),
        "F1" => s(0x3B), "F2" => s(0x3C), "F3" => s(0x3D), "F4" => s(0x3E), "F5" => s(0x3F),
        "F6" => s(0x40), "F7" => s(0x41), "F8" => s(0x42), "F9" => s(0x43), "F10" => s(0x44),
        "NumLock" => e(0x45), "ScrollLock" => s(0x46),
        "Numpad7" => s(0x47), "Numpad8" => s(0x48), "Numpad9" => s(0x49), "NumpadSubtract" => s(0x4A),
        "Numpad4" => s(0x4B), "Numpad5" => s(0x4C), "Numpad6" => s(0x4D), "NumpadAdd" => s(0x4E),
        "Numpad1" => s(0x4F), "Numpad2" => s(0x50), "Numpad3" => s(0x51), "Numpad0" => s(0x52), "NumpadDecimal" => s(0x53),
        "IntlBackslash" => s(0x56), "F11" => s(0x57), "F12" => s(0x58),
        "IntlRo" => s(0x73),        // ABNT2: tecla /? ao lado do Shift direito
        "NumpadComma" => s(0x7E),   // ABNT2: ponto do teclado numérico
        "NumpadEnter" => e(0x1C), "ControlRight" => e(0x1D), "NumpadDivide" => e(0x35), "PrintScreen" => e(0x37),
        "AltRight" => e(0x38), "Home" => e(0x47), "ArrowUp" => e(0x48), "PageUp" => e(0x49),
        "ArrowLeft" => e(0x4B), "ArrowRight" => e(0x4D), "End" => e(0x4F), "ArrowDown" => e(0x50),
        "PageDown" => e(0x51), "Insert" => e(0x52), "Delete" => e(0x53),
        "MetaLeft" => e(0x5B), "MetaRight" => e(0x5C), "ContextMenu" => e(0x5D),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn letras_e_numeros() {
        assert_eq!(scan_for("KeyA"), Some((0x1E, false)));
        assert_eq!(scan_for("KeyZ"), Some((0x2C, false)));
        assert_eq!(scan_for("Digit0"), Some((0x0B, false)));
        assert_eq!(scan_for("Digit1"), Some((0x02, false)));
    }
    #[test]
    fn estendidas() {
        for k in ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Home", "End", "ControlRight", "AltRight", "NumpadEnter", "MetaLeft"] {
            assert!(scan_for(k).unwrap().1, "{k} deveria ser estendida");
        }
        assert!(!scan_for("Enter").unwrap().1);
        assert!(!scan_for("ControlLeft").unwrap().1);
    }
    #[test]
    fn abnt2() {
        assert_eq!(scan_for("Semicolon"), Some((0x27, false))); // Ç
        assert_eq!(scan_for("IntlRo"), Some((0x73, false)));
    }
    #[test]
    fn desconhecida() {
        assert_eq!(scan_for("MediaPlayPause"), None);
        assert_eq!(scan_for(""), None);
    }
    #[test]
    fn sem_duplicatas() {
        let all = ["Escape","Digit1","Digit2","Digit3","Digit4","Digit5","Digit6","Digit7","Digit8","Digit9","Digit0","Minus","Equal","Backspace","Tab","KeyQ","KeyW","KeyE","KeyR","KeyT","KeyY","KeyU","KeyI","KeyO","KeyP","BracketLeft","BracketRight","Enter","ControlLeft","KeyA","KeyS","KeyD","KeyF","KeyG","KeyH","KeyJ","KeyK","KeyL","Semicolon","Quote","Backquote","ShiftLeft","Backslash","KeyZ","KeyX","KeyC","KeyV","KeyB","KeyN","KeyM","Comma","Period","Slash","ShiftRight","NumpadMultiply","AltLeft","Space","CapsLock","F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","NumLock","ScrollLock","Numpad7","Numpad8","Numpad9","NumpadSubtract","Numpad4","Numpad5","Numpad6","NumpadAdd","Numpad1","Numpad2","Numpad3","Numpad0","NumpadDecimal","IntlBackslash","F11","F12","IntlRo","NumpadComma","NumpadEnter","ControlRight","NumpadDivide","PrintScreen","AltRight","Home","ArrowUp","PageUp","ArrowLeft","ArrowRight","End","ArrowDown","PageDown","Insert","Delete","MetaLeft","MetaRight","ContextMenu"];
        let mut seen = std::collections::HashSet::new();
        for k in all { assert!(seen.insert(scan_for(k).unwrap()), "scancode repetido em {k}"); }
    }
}
