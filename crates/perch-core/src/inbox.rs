//! The local inbox: rules for the tiny HTTP endpoint that lets programs on this PC ask the user
//! a question (`POST /ask`). Only the parsing and checking live here, so they are unit-tested on
//! any machine; the socket itself is in `src-tauri`.
//!
//! Safety rules, all enforced here:
//! * the request must carry the user's key in `X-Perch-Key` (compared in constant time);
//! * the `Host` header must be this machine's loopback address (stops DNS rebinding);
//! * a request with an `Origin` header (a web page) is refused;
//! * sizes and counts are capped, and nothing is ever answered on the user's behalf.

use serde::Deserialize;

/// A new random key: 24 bytes from the operating system, as 48 hex characters.
pub fn new_key() -> String {
    let mut bytes = [0u8; 24];
    getrandom::getrandom(&mut bytes).expect("the operating system has no random numbers");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub const MAX_HEAD_BYTES: usize = 8 * 1024;
pub const MAX_BODY_BYTES: usize = 8 * 1024;
pub const DEFAULT_WAIT_SECS: u64 = 300;
pub const MAX_WAIT_SECS: u64 = 3600;

#[derive(Debug, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    /// header names are lower-cased
    pub headers: Vec<(String, String)>,
}

impl HttpRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    pub fn content_length(&self) -> Result<usize, Refusal> {
        match self.header("content-length") {
            None => Ok(0),
            Some(v) => {
                let n: usize = v.trim().parse().map_err(|_| Refusal::bad("bad content-length"))?;
                if n > MAX_BODY_BYTES {
                    Err(Refusal::new(413, "request is too large"))
                } else {
                    Ok(n)
                }
            }
        }
    }
}

/// Why a request was turned away: an HTTP status and a short message.
#[derive(Debug, PartialEq, Eq)]
pub struct Refusal {
    pub status: u16,
    pub message: &'static str,
}

impl Refusal {
    pub fn new(status: u16, message: &'static str) -> Self {
        Self { status, message }
    }
    fn bad(message: &'static str) -> Self {
        Self::new(400, message)
    }
}

/// Index just past the blank line that ends the request head, if it has arrived yet.
pub fn head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4)
}

pub fn parse_head(head: &str) -> Result<HttpRequest, Refusal> {
    let mut lines = head.split("\r\n");
    let request_line = lines.next().ok_or_else(|| Refusal::bad("empty request"))?;
    let mut parts = request_line.split(' ');
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();
    let version = parts.next().unwrap_or_default();
    if method.is_empty() || !path.starts_with('/') || !version.starts_with("HTTP/1.") || parts.next().is_some() {
        return Err(Refusal::bad("malformed request line"));
    }
    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':').ok_or_else(|| Refusal::bad("malformed header"))?;
        if name.is_empty() || name.contains(' ') {
            return Err(Refusal::bad("malformed header"));
        }
        headers.push((name.to_ascii_lowercase(), value.trim().to_string()));
    }
    Ok(HttpRequest { method: method.to_string(), path: path.to_string(), headers })
}

/// Same length and content, without stopping at the first difference.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn host_is_loopback(host: &str, port: u16) -> bool {
    let host = host.trim().to_ascii_lowercase();
    host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}") || host == format!("[::1]:{port}")
}

/// Check everything about a request except its body.
pub fn authorise(req: &HttpRequest, key: &str, port: u16) -> Result<(), Refusal> {
    if req.header("origin").is_some() {
        return Err(Refusal::new(403, "requests from web pages are not accepted"));
    }
    match req.header("host") {
        Some(h) if host_is_loopback(h, port) => {}
        _ => return Err(Refusal::new(403, "wrong host")),
    }
    if req.method != "POST" || req.path != "/ask" {
        return Err(Refusal::new(404, "POST /ask is the only endpoint"));
    }
    match req.header("x-perch-key") {
        Some(given) if !key.is_empty() && constant_time_eq(given.as_bytes(), key.as_bytes()) => Ok(()),
        _ => Err(Refusal::new(401, "missing or wrong X-Perch-Key")),
    }
}

#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawAsk {
    title: String,
    detail: Option<String>,
    buttons: Vec<String>,
    source: Option<String>,
    timeout_seconds: Option<u64>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Ask {
    pub title: String,
    pub detail: Option<String>,
    pub buttons: Vec<String>,
    pub source: Option<String>,
    pub wait_secs: u64,
}

fn clean(text: &str, max: usize) -> Option<String> {
    let text: String = text.chars().filter(|c| !c.is_control()).collect();
    let text = text.trim().to_string();
    if text.is_empty() || text.chars().count() > max {
        None
    } else {
        Some(text)
    }
}

pub fn parse_ask(body: &[u8]) -> Result<Ask, Refusal> {
    let raw: RawAsk = serde_json::from_slice(body).map_err(|_| Refusal::bad("body must be the JSON described in the README"))?;
    let title = clean(&raw.title, 120).ok_or_else(|| Refusal::bad("title must be 1 to 120 characters"))?;
    let detail = match raw.detail {
        None => None,
        Some(d) if d.trim().is_empty() => None,
        Some(d) => Some(clean(&d, 240).ok_or_else(|| Refusal::bad("detail must be at most 240 characters"))?),
    };
    let source = match raw.source {
        None => None,
        Some(s) => Some(clean(&s, 40).ok_or_else(|| Refusal::bad("source must be 1 to 40 characters"))?),
    };
    if raw.buttons.is_empty() || raw.buttons.len() > 3 {
        return Err(Refusal::bad("buttons must be a list of 1 to 3 labels"));
    }
    let mut buttons = Vec::new();
    for label in &raw.buttons {
        let label = clean(label, 24).ok_or_else(|| Refusal::bad("each button label must be 1 to 24 characters"))?;
        if buttons.contains(&label) {
            return Err(Refusal::bad("button labels must be different"));
        }
        buttons.push(label);
    }
    let wait_secs = raw.timeout_seconds.unwrap_or(DEFAULT_WAIT_SECS).clamp(5, MAX_WAIT_SECS);
    Ok(Ask { title, detail, buttons, source, wait_secs })
}


// ---- the server ------------------------------------------------------------------------------

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const MAX_CONNECTIONS: usize = 8;

/// What the app does with a question. Implemented in `src-tauri`; faked in the tests.
pub trait Delegate: Send + Sync + 'static {
    /// A valid question arrived. The receiver yields the button the user pressed
    /// (`Some(label)`) or `None` if they dismissed it.
    fn ask(&self, id: u64, ask: Ask) -> Receiver<Option<String>>;
    /// The asker went away or ran out of patience: take the question off the screen.
    fn cancelled(&self, id: u64);
}

pub struct Server {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    pub port: u16,
}

impl Server {
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Start answering on a listener that is already bound (to 127.0.0.1, never anything wider).
pub fn start(listener: TcpListener, key: Arc<Mutex<String>>, delegate: Arc<dyn Delegate>) -> std::io::Result<Server> {
    let addr = listener.local_addr()?;
    if !addr.ip().is_loopback() {
        return Err(std::io::Error::new(ErrorKind::InvalidInput, "the inbox only listens on the loopback address"));
    }
    listener.set_nonblocking(true)?;
    let port = addr.port();
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let counter = Arc::new(AtomicU64::new(1));
    let active = Arc::new(AtomicUsize::new(0));
    let thread = thread::spawn(move || {
        while !flag.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    if active.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                        let _ = respond(&stream, 503, serde_json::json!({ "error": "too many open questions" }));
                        continue;
                    }
                    active.fetch_add(1, Ordering::SeqCst);
                    let (key, delegate, flag, counter, active) = (key.clone(), delegate.clone(), flag.clone(), counter.clone(), active.clone());
                    thread::spawn(move || {
                        handle(stream, port, &key, delegate.as_ref(), &flag, &counter);
                        active.fetch_sub(1, Ordering::SeqCst);
                    });
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(100)),
                Err(_) => thread::sleep(Duration::from_millis(500)),
            }
        }
    });
    Ok(Server { stop, thread: Some(thread), port })
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        408 => "Request Timeout",
        413 => "Payload Too Large",
        _ => "Service Unavailable",
    }
}

fn respond(mut stream: &TcpStream, status: u16, body: serde_json::Value) -> std::io::Result<()> {
    let body = body.to_string();
    let head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        reason(status),
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

fn refuse(stream: &TcpStream, r: Refusal) {
    let _ = respond(stream, r.status, serde_json::json!({ "error": r.message }));
}

/// Read the head and body of one request, with size and time limits.
fn read_request(stream: &mut TcpStream, port: u16, key: &Mutex<String>) -> Result<Ask, Refusal> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|_| Refusal::new(503, "socket error"))?;
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 1024];
    let end = loop {
        if let Some(end) = head_end(&buf) {
            break end;
        }
        if buf.len() > MAX_HEAD_BYTES {
            return Err(Refusal::new(413, "request is too large"));
        }
        match stream.read(&mut chunk) {
            Ok(0) => return Err(Refusal::bad("connection closed early")),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => return Err(Refusal::new(408, "timed out reading the request")),
        }
    };
    let head = std::str::from_utf8(&buf[..end]).map_err(|_| Refusal::bad("request is not text"))?;
    let req = parse_head(head)?;
    {
        let key = key.lock().map_err(|_| Refusal::new(503, "internal error"))?;
        authorise(&req, &key, port)?;
    }
    let len = req.content_length()?;
    let mut body: Vec<u8> = buf[end..].to_vec();
    while body.len() < len {
        match stream.read(&mut chunk) {
            Ok(0) => return Err(Refusal::bad("connection closed early")),
            Ok(n) => body.extend_from_slice(&chunk[..n]),
            Err(_) => return Err(Refusal::new(408, "timed out reading the request")),
        }
        if body.len() > MAX_BODY_BYTES {
            return Err(Refusal::new(413, "request is too large"));
        }
    }
    body.truncate(len);
    parse_ask(&body)
}

/// Has the other end hung up? (Reads nothing; a closed socket shows up as 0 bytes.)
fn peer_closed(stream: &TcpStream) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return true;
    }
    let mut probe = [0u8; 1];
    let closed = match stream.peek(&mut probe) {
        Ok(0) => true,
        Ok(_) => false,
        Err(e) => e.kind() != ErrorKind::WouldBlock,
    };
    let _ = stream.set_nonblocking(false);
    closed
}

fn handle(mut stream: TcpStream, port: u16, key: &Mutex<String>, delegate: &dyn Delegate, stop: &AtomicBool, ids: &AtomicU64) {
    let _ = stream.set_nonblocking(false);
    let ask = match read_request(&mut stream, port, key) {
        Ok(ask) => ask,
        Err(r) => return refuse(&stream, r),
    };
    let wait = Duration::from_secs(ask.wait_secs);
    let id = ids.fetch_add(1, Ordering::SeqCst);
    let rx = delegate.ask(id, ask);
    let started = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(300)) {
            Ok(Some(label)) => {
                let _ = respond(&stream, 200, serde_json::json!({ "answer": label }));
                return;
            }
            Ok(None) | Err(RecvTimeoutError::Disconnected) => {
                let _ = respond(&stream, 200, serde_json::json!({ "answer": null, "reason": "dismissed" }));
                return;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        if stop.load(Ordering::SeqCst) || peer_closed(&stream) {
            delegate.cancelled(id);
            return;
        }
        if started.elapsed() >= wait {
            delegate.cancelled(id);
            let _ = respond(&stream, 408, serde_json::json!({ "answer": null, "reason": "timeout" }));
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(extra: &str) -> HttpRequest {
        parse_head(&format!("POST /ask HTTP/1.1\r\nHost: 127.0.0.1:47600\r\nX-Perch-Key: secret\r\n{extra}\r\n")).unwrap()
    }

    #[test]
    fn parses_a_request_head() {
        let r = req("Content-Length: 12\r\n");
        assert_eq!(r.method, "POST");
        assert_eq!(r.path, "/ask");
        assert_eq!(r.header("host"), Some("127.0.0.1:47600"));
        assert_eq!(r.content_length(), Ok(12));
    }

    #[test]
    fn finds_the_end_of_the_head() {
        assert_eq!(head_end(b"GET / HTTP/1.1\r\n\r\nbody"), Some(18));
        assert_eq!(head_end(b"GET / HTTP/1.1\r\nHost"), None);
    }

    #[test]
    fn rejects_malformed_heads() {
        assert!(parse_head("POST /ask\r\n\r\n").is_err());
        assert!(parse_head("POST ask HTTP/1.1\r\n\r\n").is_err());
        assert!(parse_head("POST /ask HTTP/1.1\r\nno colon here\r\n\r\n").is_err());
        assert!(parse_head("POST /ask HTTP/1.1 extra\r\n\r\n").is_err());
    }

    #[test]
    fn large_bodies_are_refused() {
        let r = req("Content-Length: 99999\r\n");
        assert_eq!(r.content_length().unwrap_err().status, 413);
    }

    #[test]
    fn accepts_the_right_key_on_loopback() {
        assert!(authorise(&req(""), "secret", 47600).is_ok());
    }

    #[test]
    fn refuses_a_wrong_or_missing_key() {
        assert_eq!(authorise(&req(""), "other", 47600).unwrap_err().status, 401);
        let no_key = parse_head("POST /ask HTTP/1.1\r\nHost: 127.0.0.1:47600\r\n\r\n").unwrap();
        assert_eq!(authorise(&no_key, "secret", 47600).unwrap_err().status, 401);
        assert_eq!(authorise(&req(""), "", 47600).unwrap_err().status, 401);
    }

    #[test]
    fn refuses_web_pages_and_foreign_hosts() {
        assert_eq!(authorise(&req("Origin: https://evil.example\r\n"), "secret", 47600).unwrap_err().status, 403);
        let rebinding = parse_head("POST /ask HTTP/1.1\r\nHost: evil.example:47600\r\nX-Perch-Key: secret\r\n\r\n").unwrap();
        assert_eq!(authorise(&rebinding, "secret", 47600).unwrap_err().status, 403);
        let wrong_port = parse_head("POST /ask HTTP/1.1\r\nHost: 127.0.0.1:1\r\nX-Perch-Key: secret\r\n\r\n").unwrap();
        assert_eq!(authorise(&wrong_port, "secret", 47600).unwrap_err().status, 403);
    }

    #[test]
    fn only_post_ask_exists() {
        let get = parse_head("GET /ask HTTP/1.1\r\nHost: 127.0.0.1:47600\r\nX-Perch-Key: secret\r\n\r\n").unwrap();
        assert_eq!(authorise(&get, "secret", 47600).unwrap_err().status, 404);
    }

    #[test]
    fn keys_are_long_and_different() {
        let (a, b) = (new_key(), new_key());
        assert_eq!(a.len(), 48);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn constant_time_compare() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }

    #[test]
    fn parses_an_ask() {
        let ask = parse_ask(br#"{"title":"Run npm publish?","detail":"tincakes-site 1.5.0","buttons":["Allow","Deny"],"source":"build"}"#).unwrap();
        assert_eq!(ask.title, "Run npm publish?");
        assert_eq!(ask.buttons, vec!["Allow", "Deny"]);
        assert_eq!(ask.wait_secs, DEFAULT_WAIT_SECS);
    }

    #[test]
    fn rejects_bad_asks() {
        assert!(parse_ask(b"not json").is_err());
        assert!(parse_ask(br#"{"title":"x","buttons":[]}"#).is_err());
        assert!(parse_ask(br#"{"title":"x","buttons":["a","b","c","d"]}"#).is_err());
        assert!(parse_ask(br#"{"title":"x","buttons":["a","a"]}"#).is_err());
        assert!(parse_ask(br#"{"title":"","buttons":["a"]}"#).is_err());
        assert!(parse_ask(br#"{"title":"x","buttons":["a"],"extra":1}"#).is_err());
        let long = format!(r#"{{"title":"{}","buttons":["a"]}}"#, "x".repeat(121));
        assert!(parse_ask(long.as_bytes()).is_err());
    }

    #[test]
    fn wait_time_is_clamped_and_control_characters_dropped() {
        let ask = parse_ask(br#"{"title":"a\u0007b","buttons":["ok"],"timeoutSeconds":999999}"#).unwrap();
        assert_eq!(ask.title, "ab");
        assert_eq!(ask.wait_secs, MAX_WAIT_SECS);
        let quick = parse_ask(br#"{"title":"x","buttons":["ok"],"timeoutSeconds":1}"#).unwrap();
        assert_eq!(quick.wait_secs, 5);
    }

    // ---- the server, over a real socket on this machine ----------------------------------------

    use std::collections::HashMap;
    use std::sync::mpsc::{channel, Sender};

    struct Fake {
        answer: Option<Option<String>>,
        senders: Mutex<HashMap<u64, Sender<Option<String>>>>,
        cancelled: Mutex<Vec<u64>>,
        asked: Mutex<Vec<Ask>>,
    }

    impl Fake {
        fn new(answer: Option<Option<String>>) -> Arc<Self> {
            Arc::new(Self { answer, senders: Mutex::new(HashMap::new()), cancelled: Mutex::new(vec![]), asked: Mutex::new(vec![]) })
        }
    }

    impl Delegate for Fake {
        fn ask(&self, id: u64, ask: Ask) -> Receiver<Option<String>> {
            let (tx, rx) = channel();
            self.asked.lock().unwrap().push(ask);
            match &self.answer {
                Some(a) => {
                    tx.send(a.clone()).unwrap();
                }
                None => {
                    self.senders.lock().unwrap().insert(id, tx);
                }
            }
            rx
        }
        fn cancelled(&self, id: u64) {
            self.cancelled.lock().unwrap().push(id);
        }
    }

    fn boot(delegate: Arc<Fake>) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        start(listener, Arc::new(Mutex::new("k3y".to_string())), delegate).unwrap()
    }

    fn post(port: u16, key: &str, host_port: u16, body: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let req = format!(
            "POST /ask HTTP/1.1\r\nHost: 127.0.0.1:{host_port}\r\nX-Perch-Key: {key}\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        s.write_all(req.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    const ASK: &str = r#"{"title":"Run it?","buttons":["Allow","Deny"]}"#;

    #[test]
    fn serves_an_answer() {
        let fake = Fake::new(Some(Some("Allow".into())));
        let server = boot(fake.clone());
        let out = post(server.port, "k3y", server.port, ASK);
        assert!(out.starts_with("HTTP/1.1 200 OK"), "{out}");
        assert!(out.ends_with(r#"{"answer":"Allow"}"#), "{out}");
        assert_eq!(fake.asked.lock().unwrap()[0].title, "Run it?");
        server.stop();
    }

    #[test]
    fn dismissing_answers_null() {
        let server = boot(Fake::new(Some(None)));
        let out = post(server.port, "k3y", server.port, ASK);
        assert!(out.contains(r#""answer":null"#) && out.contains("dismissed"), "{out}");
        server.stop();
    }

    #[test]
    fn nothing_reaches_the_user_without_the_key() {
        let fake = Fake::new(Some(Some("Allow".into())));
        let server = boot(fake.clone());
        assert!(post(server.port, "nope", server.port, ASK).starts_with("HTTP/1.1 401"));
        assert!(post(server.port, "k3y", 9, ASK).starts_with("HTTP/1.1 403"));
        assert!(post(server.port, "k3y", server.port, "{}").starts_with("HTTP/1.1 400"));
        assert!(fake.asked.lock().unwrap().is_empty());
        server.stop();
    }

    #[test]
    fn a_question_is_taken_back_when_the_asker_hangs_up() {
        let fake = Fake::new(None);
        let server = boot(fake.clone());
        {
            let mut s = TcpStream::connect(("127.0.0.1", server.port)).unwrap();
            let req = format!(
                "POST /ask HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Perch-Key: k3y\r\nContent-Length: {}\r\n\r\n{ASK}",
                server.port,
                ASK.len()
            );
            s.write_all(req.as_bytes()).unwrap();
            let t = Instant::now();
            while fake.asked.lock().unwrap().is_empty() && t.elapsed() < Duration::from_secs(3) {
                thread::sleep(Duration::from_millis(20));
            }
            assert_eq!(fake.asked.lock().unwrap().len(), 1);
        } // hangs up here
        let t = Instant::now();
        while fake.cancelled.lock().unwrap().is_empty() && t.elapsed() < Duration::from_secs(3) {
            thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(fake.cancelled.lock().unwrap().len(), 1);
        server.stop();
    }

    #[test]
    fn refuses_to_listen_beyond_loopback() {
        let listener = TcpListener::bind("0.0.0.0:0").unwrap();
        assert!(start(listener, Arc::new(Mutex::new("k".into())), Fake::new(None)).is_err());
    }
}
