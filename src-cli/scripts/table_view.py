import sys, json, re

data = json.load(sys.stdin)
results = data.get('results', [])

rows = []
for r in results:
    m = re.match(
        r'\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s+\[([^\]]+)\]\s+(.*)',
        r
    )
    if not m:
        continue
    ts = m.group(1)
    chat = m.group(2)
    rest = m.group(3)

    sender = ''
    msg_type = 'text'
    content = rest

    # Try to extract sender prefix: "Sender: Content"
    sender_match = re.match(r'([^:\[\]]+):\s*(.*)', rest)
    if sender_match:
        potential_sender = sender_match.group(1)
        rest2 = sender_match.group(2)
        type_inner = re.match(r'\[([^\]]+)\]\s*(.*)', rest2)
        if type_inner:
            sender = potential_sender
            msg_type = type_inner.group(1)
            content = type_inner.group(2)
        else:
            sender = potential_sender
            content = rest2
    else:
        type_match = re.match(r'\[([^\]]+)\]\s*(.*)', rest)
        if type_match:
            msg_type = type_match.group(1)
            content = type_match.group(2)

    # Clean CDATA
    content = content.replace('<![CDATA[', '').replace(']]>', '')
    # Clean XML blocks
    content = re.sub(r'<\?xml.*?\?>', '', content, flags=re.DOTALL)
    content = re.sub(r'<msg>.*?</msg>', '[媒体消息]', content, flags=re.DOTALL)
    # Remove reply prefix
    content = re.sub(r'\s*↳ 回复.*?(?=\s|$)', '', content)
    # Flatten newlines
    content = content.replace('\n', ' ').replace('\r', ' ').strip()
    # Truncate
    content_short = content[:78]
    if len(content) > 78:
        content_short += '..'

    rows.append({
        'time': ts,
        'chat': chat,
        'type': msg_type,
        'sender': sender,
        'content': content_short,
    })

if not rows:
    print('无消息')
    sys.exit(0)

col_time = 16
col_chat = max(max(len(r['chat']) for r in rows), 6) + 2
col_type = max(max(len(r['type']) for r in rows), 4) + 2
col_sender = max(max(len(r['sender']) for r in rows), 6) + 2
col_content = 80

sep = '+' + '-' * col_time + '+' + '-' * col_chat + '+' + '-' * col_type + '+' + '-' * col_sender + '+' + '-' * col_content + '+'
header = '|' + '时间'.center(col_time) + '|' + '会话'.center(col_chat) + '|' + '类型'.center(col_type) + '|' + '发送者'.center(col_sender) + '|' + '内容'.center(col_content) + '|'

print(sep)
print(header)
print(sep)

for r in rows:
    t = r['time'].ljust(col_time)
    c = r['chat'][:col_chat - 1].ljust(col_chat)
    tp = r['type'][:col_type - 1].ljust(col_type)
    s = (r['sender'][:col_sender - 1] if r['sender'] else '').ljust(col_sender)
    ct = r['content'][:col_content - 1].ljust(col_content)
    print(f'|{t}|{c}|{tp}|{s}|{ct}|')

print(sep)
print(f'共 {len(rows)} 条消息')