#!/usr/bin/env python3
"""X Manager - X (Twitter) growth management via bridge API and X API v2."""

import argparse
import hashlib
import hmac
import json
import os
import sqlite3
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

DB_PATH = os.path.expanduser("~/.openclaw/workspace/skills/x-manager/scripts/x-manager.db")
ENV_PATH = os.path.expanduser("~/.openclaw/env")

def load_env():
    env = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    env[key.strip()] = val.strip().strip('"').strip("'")
    return env

def get_config():
    env = load_env()
    os_env = os.environ
    app_url = os_env.get("X_MANAGER_APP_URL", env.get("X_MANAGER_APP_URL", "http://100.116.76.3:3999")).rstrip("/")
    return {
        "bridge_url": os_env.get("XM_BRIDGE_URL", env.get("XM_BRIDGE_URL", f"{app_url}/api/bridge/openclaw/post")),
        "bridge_token": os_env.get("OPENCLAW_BRIDGE_TOKEN", env.get("OPENCLAW_BRIDGE_TOKEN", "")),
        "signing_secret": os_env.get("OPENCLAW_BRIDGE_SIGNING_SECRET", env.get("OPENCLAW_BRIDGE_SIGNING_SECRET", "")),
        "bearer_token": os_env.get("X_BEARER_TOKEN", env.get("X_BEARER_TOKEN", "")),
        "x_api_base": os_env.get("X_API_BASE_URL", env.get("X_API_BASE_URL", "https://api.x.com/2")),
    }

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        text_preview TEXT,
        account TEXT DEFAULT 'swarm_signal',
        dry_run INTEGER DEFAULT 1,
        tweet_id TEXT,
        tweet_url TEXT,
        success INTEGER DEFAULT 0,
        error TEXT
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        query TEXT NOT NULL,
        result_count INTEGER DEFAULT 0
    )""")
    conn.commit()
    return conn

def sign_request(secret, timestamp, body_str):
    message = f"{timestamp}.{body_str}"
    sig = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return sig

def bridge_post(config, body_dict):
    body_str = json.dumps(body_dict, separators=(",", ":"))
    ts = str(int(time.time()))
    sig = sign_request(config["signing_secret"], ts, body_str)
    headers = {
        "Authorization": f"Bearer {config['bridge_token']}",
        "Content-Type": "application/json",
        "x-openclaw-timestamp": ts,
        "x-openclaw-signature": sig,
    }
    req = urllib.request.Request(config["bridge_url"], data=body_str.encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode()), None
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        try:
            err_json = json.loads(body)
        except Exception:
            err_json = {"raw": body}
        return None, {"http_code": e.code, "detail": err_json}
    except Exception as e:
        return None, {"error": str(e)}

def x_api_get(config, endpoint, params=None):
    url = f"{config['x_api_base']}/{endpoint}"
    if params:
        qs = "&".join(f"{k}={urllib.request.quote(str(v))}" for k, v in params.items())
        url = f"{url}?{qs}"
    headers = {"Authorization": f"Bearer {config['bearer_token']}"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode()), None
    except urllib.error.HTTPError as e:
        return None, {"http_code": e.code, "reason": e.reason}
    except Exception as e:
        return None, {"error": str(e)}

def check_bridge_health(config):
    readiness_url = config["bridge_url"].rsplit("/api/bridge", 1)[0] + "/api/system/readiness"
    headers = {"Authorization": f"Bearer {config['bridge_token']}"}
    req = urllib.request.Request(readiness_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode()), None
    except Exception as e:
        return None, str(e)

def cmd_status(args):
    config = get_config()
    conn = init_db()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM posts")
    total_posts = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM posts WHERE success = 1 AND dry_run = 0")
    live_posts = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM searches")
    total_searches = c.fetchone()[0]
    c.execute("SELECT timestamp, action, text_preview, success FROM posts ORDER BY id DESC LIMIT 1")
    last_post = c.fetchone()
    bridge_health, bridge_err = check_bridge_health(config)
    conn.close()
    result = {
        "status": "operational",
        "bridge_url": config["bridge_url"],
        "bridge_health": bridge_health if bridge_health else {"error": bridge_err},
        "bridge_token_set": bool(config["bridge_token"]),
        "signing_secret_set": bool(config["signing_secret"]),
        "bearer_token_set": bool(config["bearer_token"]),
        "total_posts_attempted": total_posts,
        "live_posts": live_posts,
        "total_searches": total_searches,
        "last_post": {"timestamp": last_post[0], "action": last_post[1], "preview": last_post[2], "success": bool(last_post[3])} if last_post else None
    }
    print(json.dumps(result, indent=2))

def cmd_post(args):
    config = get_config()
    conn = init_db()
    if not config["bridge_token"] or not config["signing_secret"]:
        print(json.dumps({"error": "OPENCLAW_BRIDGE_TOKEN and OPENCLAW_BRIDGE_SIGNING_SECRET must be set"}))
        sys.exit(1)
    body = {
        "text": args.text,
        "account": args.account,
        "dryRun": not args.live
    }
    if args.reply_to:
        body["reply_to_tweet_id"] = args.reply_to
    if args.media:
        body["media_urls"] = args.media
    resp, err = bridge_post(config, body)
    c = conn.cursor()
    success = bool(resp and resp.get("success"))
    tweet_id = (resp.get("tweetId") or "") if resp else ""
    tweet_url = (resp.get("tweetUrl") or "") if resp else ""
    error_msg = json.dumps(err) if err else None
    c.execute("INSERT INTO posts (timestamp, action, text_preview, account, dry_run, tweet_id, tweet_url, success, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
              (datetime.now().isoformat(), "reply" if args.reply_to else "post",
               args.text[:100], args.account, 0 if args.live else 1,
               tweet_id, tweet_url, 1 if success else 0, error_msg))
    conn.commit()
    conn.close()
    output = {
        "timestamp": datetime.now().isoformat(),
        "dry_run": not args.live,
        "account": args.account,
    }
    if resp:
        output["response"] = resp
    if err:
        output["error"] = err
    print(json.dumps(output, indent=2))

def cmd_search(args):
    config = get_config()
    conn = init_db()
    if not config["bearer_token"]:
        print(json.dumps({"error": "X_BEARER_TOKEN must be set"}))
        sys.exit(1)
    params = {
        "query": args.query,
        "max_results": args.max_results,
        "tweet.fields": "created_at,author_id,public_metrics"
    }
    data, err = x_api_get(config, "tweets/search/recent", params)
    c = conn.cursor()
    result_count = len(data.get("data", [])) if data else 0
    c.execute("INSERT INTO searches (timestamp, query, result_count) VALUES (?, ?, ?)",
              (datetime.now().isoformat(), args.query, result_count))
    conn.commit()
    conn.close()
    if err:
        print(json.dumps({"error": err, "query": args.query}))
        sys.exit(1)
    tweets = []
    for t in data.get("data", []):
        metrics = t.get("public_metrics", {})
        tweets.append({
            "id": t["id"],
            "text": t.get("text", ""),
            "created_at": t.get("created_at", ""),
            "author_id": t.get("author_id", ""),
            "likes": metrics.get("like_count", 0),
            "retweets": metrics.get("retweet_count", 0),
            "replies": metrics.get("reply_count", 0)
        })
    print(json.dumps({"query": args.query, "count": len(tweets), "tweets": tweets}, indent=2))

def cmd_read(args):
    config = get_config()
    if not config["bearer_token"]:
        print(json.dumps({"error": "X_BEARER_TOKEN must be set"}))
        sys.exit(1)
    tweet_id = args.tweet_id
    if "/" in tweet_id:
        tweet_id = tweet_id.rstrip("/").split("/")[-1]
    params = {"tweet.fields": "created_at,author_id,public_metrics,conversation_id"}
    data, err = x_api_get(config, f"tweets/{tweet_id}", params)
    if err:
        print(json.dumps({"error": err}))
        sys.exit(1)
    print(json.dumps(data, indent=2))

def cmd_history(args):
    conn = init_db()
    c = conn.cursor()
    c.execute("SELECT id, timestamp, action, text_preview, account, dry_run, tweet_url, success, error FROM posts ORDER BY id DESC LIMIT ?", (args.limit,))
    rows = c.fetchall()
    conn.close()
    posts = [{
        "id": r[0], "timestamp": r[1], "action": r[2], "preview": r[3],
        "account": r[4], "dry_run": bool(r[5]), "url": r[6],
        "success": bool(r[7]), "error": r[8]
    } for r in rows]
    print(json.dumps({"posts": posts}, indent=2))

def main():
    parser = argparse.ArgumentParser(description="X Manager - X/Twitter growth management")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Show service status and bridge health")

    post_p = sub.add_parser("post", help="Post a tweet via bridge")
    post_p.add_argument("text", help="Tweet text")
    post_p.add_argument("--account", default="swarm_signal", help="Account to post as")
    post_p.add_argument("--live", action="store_true", help="Actually post (default is dry-run)")
    post_p.add_argument("--reply-to", help="Tweet ID to reply to")
    post_p.add_argument("--media", nargs="+", help="Media URLs to attach")

    search_p = sub.add_parser("search", help="Search tweets via X API v2")
    search_p.add_argument("query", help="Search query")
    search_p.add_argument("--max-results", type=int, default=10, help="Max results (1-100)")

    read_p = sub.add_parser("read", help="Read a specific tweet")
    read_p.add_argument("tweet_id", help="Tweet ID or URL")

    hist_p = sub.add_parser("history", help="Show post/search history")
    hist_p.add_argument("--limit", type=int, default=10, help="Number of entries")

    args = parser.parse_args()
    {"status": cmd_status, "post": cmd_post, "search": cmd_search, "read": cmd_read, "history": cmd_history}[args.command](args)

if __name__ == "__main__":
    main()
