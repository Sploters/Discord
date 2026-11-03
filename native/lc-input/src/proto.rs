//! Protocolo com o app desktop: uma linha JSON por comando na entrada padrão.
//!   {"t":"arm","rect":[x,y,w,h]}   liga a injeção para o monitor transmitido (pixels físicos)
//!   {"t":"disarm"}                 desliga e solta tudo
//!   {"t":"ev","ev":[...]}          eventos já validados pelo servidor; validados de novo aqui
//! Nada aqui toca o Windows: só transforma texto em ações (testável em qualquer sistema).
use crate::keymap::scan_for;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect { pub x: i32, pub y: i32, pub w: i32, pub h: i32 }

#[derive(Debug, PartialEq)]
pub enum Action {
    MoveTo { x: i32, y: i32 },        // pixel físico absoluto na área de trabalho virtual
    Button { b: u8, down: bool },     // 0 esquerdo, 1 meio, 2 direito (como MouseEvent.button)
    Wheel { dx: i32, dy: i32 },       // unidades do Windows (120 = um "dente"); dy > 0 = para baixo
    Key { scan: u16, ext: bool, down: bool },
}

#[derive(Debug, PartialEq)]
pub enum Cmd { Arm(Rect), Disarm, Events(Vec<Raw>), Bad }

#[derive(Deserialize)]
struct Line { t: String, rect: Option<[i64; 4]>, ev: Option<Vec<serde_json::Value>> }

const MAX_EVENTS: usize = 64;

pub fn parse(line: &str) -> Cmd {
    if line.len() > 16 * 1024 { return Cmd::Bad; }
    let Ok(l) = serde_json::from_str::<Line>(line) else { return Cmd::Bad };
    match l.t.as_str() {
        "arm" => match l.rect {
            Some([x, y, w, h]) if w > 0 && h > 0 && w <= 32768 && h <= 32768 && x.abs() <= 65536 && y.abs() <= 65536 =>
                Cmd::Arm(Rect { x: x as i32, y: y as i32, w: w as i32, h: h as i32 }),
            _ => Cmd::Bad,
        },
        "disarm" => Cmd::Disarm,
        "ev" => Cmd::Events(l.ev.unwrap_or_default().iter().take(MAX_EVENTS).filter_map(raw_event).collect()),
        _ => Cmd::Bad,
    }
}

/// Evento cru (coordenadas 0..1) -> ação intermediária; o retângulo só entra em `place`.
#[derive(Debug, PartialEq)]
pub enum Raw { Move(f64, f64), Act(Action) }

fn raw_event(v: &serde_json::Value) -> Option<Raw> {
    let k = v.get("k")?.as_str()?;
    let f = |n: &str| v.get(n).and_then(|x| x.as_f64()).filter(|x| x.is_finite());
    match k {
        "m" => { let (x, y) = (f("x")?, f("y")?); if (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y) { Some(Raw::Move(x, y)) } else { None } }
        "d" | "u" => { let b = f("b")?; if b == 0.0 || b == 1.0 || b == 2.0 { Some(Raw::Act(Action::Button { b: b as u8, down: k == "d" })) } else { None } }
        "w" => { let (dx, dy) = (f("dx").unwrap_or(0.0), f("dy").unwrap_or(0.0)); if dx.abs() <= 2400.0 && dy.abs() <= 2400.0 && (dx != 0.0 || dy != 0.0) { Some(Raw::Act(Action::Wheel { dx: dx as i32, dy: dy as i32 })) } else { None } }
        "kd" | "ku" => { let (scan, ext) = scan_for(v.get("c")?.as_str()?)?; Some(Raw::Act(Action::Key { scan, ext, down: k == "kd" })) }
        _ => None,
    }
}

/// Converte as coordenadas normalizadas para pixels do monitor transmitido (sempre dentro dele).
pub fn place(raw: Raw, r: Rect) -> Action {
    match raw {
        Raw::Move(x, y) => Action::MoveTo {
            x: r.x + ((x * (r.w - 1) as f64).round() as i32).clamp(0, r.w - 1),
            y: r.y + ((y * (r.h - 1) as f64).round() as i32).clamp(0, r.h - 1),
        },
        Raw::Act(a) => a,
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arm_e_disarm() {
        assert_eq!(parse(r#"{"t":"arm","rect":[1920,0,2560,1440]}"#), Cmd::Arm(Rect { x: 1920, y: 0, w: 2560, h: 1440 }));
        assert_eq!(parse(r#"{"t":"arm","rect":[0,0,0,1080]}"#), Cmd::Bad);
        assert_eq!(parse(r#"{"t":"disarm"}"#), Cmd::Disarm);
        assert_eq!(parse("lixo"), Cmd::Bad);
        assert_eq!(parse(r#"{"t":"exec","cmd":"calc"}"#), Cmd::Bad);
    }
    #[test]
    fn coordenadas_dentro_do_monitor() {
        let r = Rect { x: -1920, y: 0, w: 1920, h: 1080 }; // monitor à esquerda do principal
        assert_eq!(place(Raw::Move(0.0, 0.0), r), Action::MoveTo { x: -1920, y: 0 });
        assert_eq!(place(Raw::Move(1.0, 1.0), r), Action::MoveTo { x: -1, y: 1079 });
        assert_eq!(place(Raw::Move(0.5, 0.5), r), Action::MoveTo { x: -960, y: 540 });
    }
    #[test]
    fn eventos_invalidos_sao_descartados() {
        let Cmd::Events(v) = parse(r#"{"t":"ev","ev":[{"k":"m","x":1.5,"y":0},{"k":"d","b":7},{"k":"kd","c":"Inexistente"},{"k":"w","dx":0,"dy":0},{"k":"zz"},{"k":"m","x":0.25,"y":0.75},{"k":"kd","c":"KeyA"},{"k":"u","b":2}]}"#) else { panic!() };
        assert_eq!(v.len(), 3);
        assert_eq!(v[0], Raw::Move(0.25, 0.75));
        assert_eq!(v[1], Raw::Act(Action::Key { scan: 0x1E, ext: false, down: true }));
        assert_eq!(v[2], Raw::Act(Action::Button { b: 2, down: false }));
    }
    #[test]
    fn limite_de_eventos_por_linha() {
        let many = (0..200).map(|_| r#"{"k":"kd","c":"KeyA"}"#).collect::<Vec<_>>().join(",");
        let Cmd::Events(v) = parse(&format!(r#"{{"t":"ev","ev":[{many}]}}"#)) else { panic!() };
        assert_eq!(v.len(), MAX_EVENTS);
    }
}
