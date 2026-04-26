# rules.py — OWASP CRS rule knowledge base
# Maps rule ID prefix (first 3 digits) → human-readable metadata

RULE_GROUPS: dict[str, dict] = {
    "910": {
        "category":       "IP Reputation",
        "attack_type":    "Known Bad Actor",
        "owasp_category": "A07:2021 – Identification and Authentication Failures",
        "owasp_top10":    "A07",
        "description":    "Request originated from an IP address with a known bad reputation, "
                          "found on public blocklists, or previously associated with scanning or attack activity.",
        "risk":           "HIGH",
        "remediation":    "If this is a legitimate user, whitelist their IP in the WAF exclusion rules. "
                          "Otherwise consider permanently banning the IP via fail2ban.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
    },
    "911": {
        "category":       "Method Enforcement",
        "attack_type":    "Disallowed HTTP Method",
        "owasp_category": "A01:2021 – Broken Access Control",
        "owasp_top10":    "A01",
        "description":    "Request used an HTTP method that is not permitted (e.g. TRACE, CONNECT, "
                          "or an unusual PUT/DELETE). Could indicate reconnaissance or exploitation.",
        "risk":           "MEDIUM",
        "remediation":    "If this is a legitimate API call, add the method to the CRS allowed-methods list. "
                          "Otherwise block the IP — this is likely automated probing.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
    },
    "912": {
        "category":       "DoS Protection",
        "attack_type":    "Denial of Service",
        "owasp_category": "A05:2021 – Security Misconfiguration",
        "owasp_top10":    "A05",
        "description":    "Request rate from this client has exceeded configured thresholds, "
                          "indicating a potential denial-of-service or brute-force attempt.",
        "risk":           "HIGH",
        "remediation":    "Enable rate-limiting in nginx/NPM. Consider adding this IP to fail2ban. "
                          "Review whether a CDN or DDoS mitigation service is needed.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/",
    },
    "913": {
        "category":       "Scanner Detection",
        "attack_type":    "Automated Scanner",
        "owasp_category": "A05:2021 – Security Misconfiguration",
        "owasp_top10":    "A05",
        "description":    "Request matches patterns associated with automated security scanners "
                          "(Nikto, Nessus, OpenVAS, SQLMap, etc.) or reconnaissance tools.",
        "risk":           "HIGH",
        "remediation":    "Permanently ban this IP via fail2ban. Scanners are probing for vulnerabilities. "
                          "Review server logs for what the scanner discovered or accessed.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/",
    },
    "920": {
        "category":       "Protocol Enforcement",
        "attack_type":    "Malformed HTTP Request",
        "owasp_category": "A04:2021 – Insecure Design",
        "owasp_top10":    "A04",
        "description":    "Request violates HTTP protocol standards: missing required headers, "
                          "invalid content-length, malformed multipart boundaries, or suspicious encoding.",
        "risk":           "MEDIUM",
        "remediation":    "Legitimate browsers always send well-formed requests. This is likely a script or tool. "
                          "Review whether a specific legitimate client triggers this before blocking.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A04_2021-Insecure_Design/",
    },
    "921": {
        "category":       "Protocol Attack",
        "attack_type":    "HTTP Request Smuggling",
        "owasp_category": "A03:2021 – Injection",
        "owasp_top10":    "A03",
        "description":    "Request contains patterns consistent with HTTP request smuggling or "
                          "HTTP response splitting — techniques used to bypass security controls or poison caches.",
        "risk":           "CRITICAL",
        "remediation":    "Block this IP immediately. Keep nginx/NPM up to date. "
                          "Review your infrastructure for proxy inconsistencies that enable split-request attacks.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A03_2021-Injection/",
    },
    "930": {
        "category":       "Local File Inclusion",
        "attack_type":    "LFI",
        "owasp_category": "A01:2021 – Broken Access Control",
        "owasp_top10":    "A01",
        "description":    "Request contains path traversal sequences (../../../etc/passwd) or "
                          "references to sensitive local files, attempting to read files outside the web root.",
        "risk":           "CRITICAL",
        "remediation":    "Block this IP immediately. An LFI attack could expose credentials or sensitive config. "
                          "Audit all file-path inputs in your application code and sanitize them server-side.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
    },
    "931": {
        "category":       "Remote File Inclusion",
        "attack_type":    "RFI",
        "owasp_category": "A03:2021 – Injection",
        "owasp_top10":    "A03",
        "description":    "Request attempts to include remote files (malicious scripts hosted externally) "
                          "into server-side execution, potentially achieving remote code execution.",
        "risk":           "CRITICAL",
        "remediation":    "Block this IP immediately. Disable PHP `allow_url_include`. "
                          "Never pass user-supplied data to include() or require() calls.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A03_2021-Injection/",
    },
    "932": {
        "category":       "Remote Code Execution",
        "attack_type":    "RCE / Command Injection",
        "owasp_category": "A03:2021 – Injection",
        "owasp_top10":    "A03",
        "description":    "Request contains OS command injection patterns — shell metacharacters, "
                          "common Unix/Windows commands, or chaining operators that could execute arbitrary code.",
        "risk":           "CRITICAL",
        "remediation":    "Block this IP immediately. Never pass user input to OS commands. "
                          "Use subprocess with argument lists (not shell=True). Audit all exec/system calls.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A03_2021-Injection/",
    },
    "933": {
        "category":       "PHP Injection",
        "attack_type":    "PHP Code Injection",
        "owasp_category": "A03:2021 – Injection",
        "owasp_top10":    "A03",
        "description":    "Request contains PHP-specific injection patterns: PHP tags, function calls "
                          "(eval, system, exec), or variable injection that could execute arbitrary PHP code.",
        "risk":           "CRITICAL",
        "remediation":    "Block this IP. Disable PHP error display in production. "
                          "Never evaluate user input as PHP. Keep PHP and all plugins/themes updated.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A03_2021-Injection/",
    },
    "934": {
        "category":       "Node.js Injection",
        "attack_type":    "Server-Side JS Injection",
        "owasp_category": "A03:2021 – Injection",
        "owasp_top10":    "A03",
        "description":    "Request targets Node.js vulnerabilities: prototype pollution, eval injection, "
                          "or server-side template injection in Node.js frameworks.",
        "risk":           "CRITICAL",
        "remediation":    "Block this IP. Avoid eval() and Function() with user input. "
                          "Use parameterized queries. Freeze prototypes or use Object.create(null) for untrusted data.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A03_2021-Injection/",
    },
    "941": {
        "category":       "Cross-Site Scripting",
        "attack_type":    "XSS",
        "owasp_category": "A03:2021 – Injection",
        "owasp_top10":    "A03",
        "description":    "Request contains XSS payloads: script tags, JavaScript event handlers "
                          "(onerror, onload), JavaScript URIs, or HTML injection that could execute in a victim browser.",
        "risk":           "HIGH",
        "remediation":    "Encode all output. Implement a strict Content Security Policy (CSP). "
                          "Sanitize HTML with an allowlist. Use HttpOnly and Secure cookie flags.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A03_2021-Injection/",
    },
    "942": {
        "category":       "SQL Injection",
        "attack_type":    "SQLi",
        "owasp_category": "A03:2021 – Injection",
        "owasp_top10":    "A03",
        "description":    "Request contains SQL injection patterns: keywords (UNION, SELECT, DROP), "
                          "comment sequences (--), boolean tests, or time-based blind injection payloads.",
        "risk":           "CRITICAL",
        "remediation":    "Always use parameterized queries or prepared statements. "
                          "Never concatenate user input into SQL. Use an ORM. "
                          "Block this IP and review database logs for successful injection.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A03_2021-Injection/",
    },
    "943": {
        "category":       "Session Fixation",
        "attack_type":    "Session Fixation",
        "owasp_category": "A07:2021 – Identification and Authentication Failures",
        "owasp_top10":    "A07",
        "description":    "Request attempts session fixation — injecting a known session token before "
                          "authentication to hijack the session after login.",
        "risk":           "HIGH",
        "remediation":    "Regenerate session IDs after every authentication event. "
                          "Never accept session IDs from URL parameters. Use SameSite=Strict cookies.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
    },
    "944": {
        "category":       "Java Attack",
        "attack_type":    "Java Deserialization / Log4Shell",
        "owasp_category": "A08:2021 – Software and Data Integrity Failures",
        "owasp_top10":    "A08",
        "description":    "Request targets Java vulnerabilities: insecure deserialization, Apache Struts RCE, "
                          "Log4Shell (CVE-2021-44228), Spring4Shell, or Java expression language injection.",
        "risk":           "CRITICAL",
        "remediation":    "Immediately check if your stack includes vulnerable Java versions. "
                          "Apply vendor patches. For Log4Shell: update log4j to 2.17.1+ immediately.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/",
    },
    "949": {
        "category":       "Anomaly Scoring",
        "attack_type":    "Inbound Score Exceeded",
        "owasp_category": "Defense in Depth",
        "owasp_top10":    None,
        "description":    "The accumulated anomaly score for this request exceeded the inbound threshold. "
                          "Individual rules contributed scores; the total crossed the block threshold.",
        "risk":           "HIGH",
        "remediation":    "Review the other rule matches in this transaction — they show the specific attacks. "
                          "The combined score indicates high confidence. "
                          "Consider lowering the inbound threshold (default 5) for stricter enforcement.",
        "crs_doc_url":    "https://coreruleset.org/docs/concepts/anomaly_scoring/",
        "owasp_url":      "https://owasp.org/www-project-modsecurity-core-rule-set/",
    },
    "950": {
        "category":       "Response Data Leakage",
        "attack_type":    "Outbound Data Leak",
        "owasp_category": "A02:2021 – Cryptographic Failures",
        "owasp_top10":    "A02",
        "description":    "The server response contains sensitive data patterns: credit card numbers, "
                          "SSNs, or internal error messages that could reveal system internals.",
        "risk":           "HIGH",
        "remediation":    "Review error handling — never expose stack traces or DB errors to users. "
                          "Disable verbose error mode in production. Audit responses for accidental PII exposure.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/",
    },
    "951": {
        "category":       "SQL Error Leakage",
        "attack_type":    "Database Error Disclosure",
        "owasp_category": "A05:2021 – Security Misconfiguration",
        "owasp_top10":    "A05",
        "description":    "The server response leaks SQL error messages (MySQL, MSSQL, Oracle, PostgreSQL) "
                          "that reveal database structure, table names, or credentials.",
        "risk":           "HIGH",
        "remediation":    "Disable display_errors in PHP. Use generic error pages. "
                          "Never expose raw database exceptions. Log errors server-side only.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/",
    },
    "952": {
        "category":       "Java Information Leakage",
        "attack_type":    "Java Stack Trace Disclosure",
        "owasp_category": "A05:2021 – Security Misconfiguration",
        "owasp_top10":    "A05",
        "description":    "The server response contains Java stack traces or error messages that "
                          "reveal internal class names, file paths, or library versions.",
        "risk":           "MEDIUM",
        "remediation":    "Configure a custom error page for 500 errors. "
                          "Disable debug mode in your Java application framework (Spring, Tomcat, etc.).",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/",
    },
    "953": {
        "category":       "PHP Information Leakage",
        "attack_type":    "PHP Error Disclosure",
        "owasp_category": "A05:2021 – Security Misconfiguration",
        "owasp_top10":    "A05",
        "description":    "The server response contains PHP error messages, warnings, or notices "
                          "that reveal file paths, function names, or internal application logic.",
        "risk":           "MEDIUM",
        "remediation":    "Set display_errors=Off and log_errors=On in php.ini. "
                          "Use a custom error handler. Never expose PHP internals to users.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/",
    },
    "954": {
        "category":       "IIS Information Leakage",
        "attack_type":    "IIS Error Disclosure",
        "owasp_category": "A05:2021 – Security Misconfiguration",
        "owasp_top10":    "A05",
        "description":    "The server response contains IIS-specific error messages that reveal "
                          "server version, internal paths, or ASP.NET configuration.",
        "risk":           "MEDIUM",
        "remediation":    "Enable custom errors in IIS. Remove server version headers. "
                          "Use a generic 500 error page that reveals no internals.",
        "crs_doc_url":    "https://coreruleset.org/docs/rules/paranoia_levels/",
        "owasp_url":      "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/",
    },
    "980": {
        "category":       "Anomaly Scoring",
        "attack_type":    "Outbound Score Exceeded",
        "owasp_category": "Defense in Depth",
        "owasp_top10":    None,
        "description":    "The accumulated anomaly score for this response exceeded the outbound threshold. "
                          "The response may contain sensitive data or error information.",
        "risk":           "MEDIUM",
        "remediation":    "Investigate the outbound rule matches (950xxx, 951xxx) in this transaction. "
                          "Harden your application's error handling and output encoding.",
        "crs_doc_url":    "https://coreruleset.org/docs/concepts/anomaly_scoring/",
        "owasp_url":      "https://owasp.org/www-project-modsecurity-core-rule-set/",
    },
}

_UNKNOWN = {
    "category":       "Unknown Rule",
    "attack_type":    "Unknown",
    "owasp_category": "Unknown",
    "owasp_top10":    None,
    "description":    "A WAF rule matched this request. Consult the OWASP CRS documentation for "
                      "details about this specific rule ID.",
    "risk":           "MEDIUM",
    "remediation":    "Review the matched data and rule ID to determine the appropriate response. "
                      "Check the CRS changelog for newly added rules.",
    "crs_doc_url":    "https://coreruleset.org/docs/",
    "owasp_url":      "https://owasp.org/www-project-modsecurity-core-rule-set/",
}

_SEVERITY_SCORE = {
    "CRITICAL": 6,
    "EMERGENCY": 5,
    "ALERT": 5,
    "ERROR": 4,
    "WARNING": 3,
    "NOTICE": 2,
    "INFO": 1,
    "DEBUG": 0,
}


def get_rule_meta(rule_id: str) -> dict:
    """Return knowledge-base metadata for a CRS rule ID (match on first 3 digits)."""
    if not rule_id or len(rule_id) < 3:
        return _UNKNOWN
    return RULE_GROUPS.get(rule_id[:3], _UNKNOWN)


def top_severity(messages: list[dict]) -> str:
    """Return the highest severity string from a list of audit log message objects."""
    best = "INFO"
    for msg in messages:
        sev = msg.get("details", {}).get("severity", "INFO").upper()
        if _SEVERITY_SCORE.get(sev, 0) > _SEVERITY_SCORE.get(best, 0):
            best = sev
    return best


def severity_color(sev: str) -> str:
    return {
        "CRITICAL":  "rose",
        "EMERGENCY": "rose",
        "ALERT":     "rose",
        "ERROR":     "orange",
        "WARNING":   "amber",
        "NOTICE":    "sky",
        "INFO":      "gray",
        "DEBUG":     "gray",
    }.get(sev.upper(), "gray")
