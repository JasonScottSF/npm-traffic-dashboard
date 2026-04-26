"""
signatures.py — lightweight attack signature patterns for breach detection.

These are intentionally conservative (low false-positive rate) patterns
used to flag requests that SHOULD have been blocked by the WAF but weren't.
"""

import re
from typing import Optional

SIGNATURES = [
    {
        "id":       "SIG-SQLI-001",
        "name":     "SQL Injection — UNION SELECT",
        "pattern":  re.compile(r"(?i)\bunion\b.{0,20}\bselect\b"),
        "targets":  ["path", "query", "body"],
        "severity": "CRITICAL",
        "category": "SQL Injection",
    },
    {
        "id":       "SIG-SQLI-002",
        "name":     "SQL Injection — comment terminator",
        "pattern":  re.compile(r"(?i)(--|#)\s*$|\bor\b\s+\d+=\d+|'\s*or\s*'"),
        "targets":  ["query", "body"],
        "severity": "HIGH",
        "category": "SQL Injection",
    },
    {
        "id":       "SIG-SQLI-003",
        "name":     "SQL Injection — DROP/INSERT/DELETE",
        "pattern":  re.compile(r"(?i)\b(drop|insert\s+into|delete\s+from|truncate)\b"),
        "targets":  ["path", "query", "body"],
        "severity": "CRITICAL",
        "category": "SQL Injection",
    },
    {
        "id":       "SIG-XSS-001",
        "name":     "XSS — script tag",
        "pattern":  re.compile(r"(?i)<\s*script[\s>]"),
        "targets":  ["path", "query", "body"],
        "severity": "HIGH",
        "category": "XSS",
    },
    {
        "id":       "SIG-XSS-002",
        "name":     "XSS — event handler",
        "pattern":  re.compile(r"(?i)\bon(error|load|click|mouseover|focus|blur)\s*="),
        "targets":  ["path", "query", "body"],
        "severity": "HIGH",
        "category": "XSS",
    },
    {
        "id":       "SIG-XSS-003",
        "name":     "XSS — javascript: URI",
        "pattern":  re.compile(r"(?i)javascript\s*:"),
        "targets":  ["path", "query", "body"],
        "severity": "HIGH",
        "category": "XSS",
    },
    {
        "id":       "SIG-LFI-001",
        "name":     "LFI — path traversal",
        "pattern":  re.compile(r"(\.\./|\.\.\\){2,}|%2e%2e[%2f%5c]"),
        "targets":  ["path", "query"],
        "severity": "CRITICAL",
        "category": "LFI",
    },
    {
        "id":       "SIG-LFI-002",
        "name":     "LFI — sensitive file reference",
        "pattern":  re.compile(r"(?i)(etc/passwd|etc/shadow|win\.ini|boot\.ini|/proc/self)"),
        "targets":  ["path", "query", "body"],
        "severity": "CRITICAL",
        "category": "LFI",
    },
    {
        "id":       "SIG-RCE-001",
        "name":     "RCE — shell metacharacters",
        "pattern":  re.compile(r"[;|`]\s*(cat|ls|id|whoami|uname|pwd|wget|curl|bash|sh)\b"),
        "targets":  ["path", "query", "body"],
        "severity": "CRITICAL",
        "category": "RCE",
    },
    {
        "id":       "SIG-RCE-002",
        "name":     "RCE — command substitution",
        "pattern":  re.compile(r"`[^`]+`|\$\([^)]+\)"),
        "targets":  ["path", "query", "body"],
        "severity": "CRITICAL",
        "category": "RCE",
    },
    {
        "id":       "SIG-PHP-001",
        "name":     "PHP — code tag",
        "pattern":  re.compile(r"<\?php|<\?="),
        "targets":  ["path", "query", "body"],
        "severity": "CRITICAL",
        "category": "PHP Injection",
    },
    {
        "id":       "SIG-JAVA-001",
        "name":     "Log4Shell — JNDI lookup",
        "pattern":  re.compile(r"\$\{jndi:", re.IGNORECASE),
        "targets":  ["path", "query", "body", "headers"],
        "severity": "CRITICAL",
        "category": "Log4Shell",
    },
    {
        "id":       "SIG-SCAN-001",
        "name":     "Scanner — known tool user-agent",
        "pattern":  re.compile(r"(?i)(sqlmap|nikto|nmap|nuclei|masscan|zgrab|dirbuster|gobuster|ffuf|wfuzz|hydra|burpsuite|acunetix|nessus|openvas)"),
        "targets":  ["headers"],
        "severity": "HIGH",
        "category": "Scanner",
    },
    {
        "id":       "SIG-RFI-001",
        "name":     "RFI — remote URL inclusion",
        "pattern":  re.compile(r"(?i)(https?|ftp)://[a-z0-9.-]+/[^\s]*\.(php|asp|aspx|jsp|sh|pl)"),
        "targets":  ["query", "body"],
        "severity": "CRITICAL",
        "category": "RFI",
    },
]


def inspect(path: str, query: str, body: str, headers: dict) -> Optional[dict]:
    """
    Check a request against all signatures.
    Returns the first match, or None if clean.
    """
    targets = {
        "path":    path or "",
        "query":   query or "",
        "body":    body or "",
        "headers": " ".join(f"{k}: {v}" for k, v in headers.items()),
    }

    for sig in SIGNATURES:
        for target_name in sig["targets"]:
            text = targets.get(target_name, "")
            if text and sig["pattern"].search(text):
                return {
                    "sig_id":   sig["id"],
                    "name":     sig["name"],
                    "severity": sig["severity"],
                    "category": sig["category"],
                    "target":   target_name,
                    "matched":  text[:200],
                }
    return None
