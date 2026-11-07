#!/usr/bin/env python3
"""手机/电脑共用的教学客户端，仅使用 Python 标准库。"""
import argparse
import base64
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description='通过 Tailscale 控制共享白板与学习记录')
    parser.add_argument('--config', default=str(Path(__file__).with_name('study-client.json')))
    parser.add_argument('--lesson', help='与电脑 CLI --session 相同的课程标识')
    parser.add_argument('--out', help='将截图保存到指定本地文件，避免输出 base64')
    parser.add_argument('command', choices=['tools', 'context', 'status', 'call'])
    parser.add_argument('tool', nargs='?')
    parser.add_argument('--file', help='工具参数 JSON；用 - 从标准输入读取')
    parser.add_argument('--subject', choices=['math', 'english', 'politics', 'it'])
    args = parser.parse_args()
    try:
        config = json.loads(Path(args.config).read_text(encoding='utf-8-sig'))
        if not all(isinstance(config.get(k), str) and config[k].strip() for k in ('url', 'token')):
            raise ValueError('配置缺少 url 或 token')
    except (OSError, ValueError) as error:
        print(f'无法读取连接配置：{error}。请将接入包解压后使用，或通过 --config 指定配置文件。', file=sys.stderr)
        return 1
    base = config['url'].rstrip('/')
    if not (base.startswith('https://') or base.startswith('http://127.0.0.1:')):
        parser.error('仅允许 HTTPS 或本机测试地址')
    headers = {'Authorization': 'Bearer ' + config['token'], 'Accept': 'application/json'}
    payload = None
    if args.command in ['tools', 'status']:
        endpoint = '/agent/' + args.command
    else:
        endpoint = '/agent/call'
        name = 'study_context' if args.command == 'context' else args.tool
        if not name:
            parser.error('call 后需要工具名')
        data = {'subject': args.subject} if args.command == 'context' and args.subject else {}
        if args.file:
            text = sys.stdin.read() if args.file == '-' else Path(args.file).read_text(encoding='utf-8-sig')
            data = json.loads(text)
        payload = json.dumps({'name': name, 'arguments': data, 'lesson': args.lesson or config.get('lesson')}, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + endpoint, data=payload, headers=headers)
    # Direct tailnet traffic should not be sent through a phone/system HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=40) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        print(error.read().decode('utf-8', errors='replace'), file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print(f'无法连接。检查手机 Tailscale、电脑在线状态和服务：{error.reason}', file=sys.stderr)
        return 1
    except (TimeoutError, ConnectionError, json.JSONDecodeError) as error:
        print(f'连接超时、中断或响应异常：{error}。没有确认写入成功；重试学习汇报时沿用原 request_id。', file=sys.stderr)
        return 1
    for index, part in enumerate(result.get('content', [])):
        if part.get('type') == 'image':
            target = Path(args.out or f'whiteboard-{index}.png').resolve()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(base64.b64decode(part.pop('data')))
            part['saved_to'] = str(target)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result.get('isError') else 0


if __name__ == '__main__':
    sys.exit(main())
