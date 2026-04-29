import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractM365CanonicalConversation,
  extractM365Messages,
  startM365ChatExtractor,
} from './m365ChatExtractor';

describe('extractM365Messages', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'table').mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('collapses nested M365 message nodes into one logical message per article', () => {
    document.body.innerHTML = `
      <main>
        <article role="article" class="fai-UserMessage root-user">
          <div class="fai-UserMessage inner-user">
            <span>You said:</span>
            <p>Hello Copilot</p>
          </div>
        </article>
        <article role="article" class="fai-CopilotMessage root-assistant">
          <section class="fai-CopilotMessage inner-assistant">
            <p>Hello from Copilot</p>
          </section>
        </article>
      </main>
    `;

    const result = extractM365Messages();

    expect(result.totalMessages).toBe(2);
    expect(result.userMessages).toBe(1);
    expect(result.assistantMessages).toBe(1);
    expect(result.messages.map((message) => message.type)).toEqual(['user', 'assistant']);
    expect(result.messages[0].text).toBe('Hello Copilot');
    expect(result.messages[1].text).toBe('Hello from Copilot');
    expect(result.messages.every((message) => message.id.startsWith('m365:'))).toBe(true);
  });

  it('drops empty user placeholders after stripping You said labels', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-UserMessage">
        <div class="fai-UserMessage">You said:</div>
      </article>
      <article role="article" class="fai-CopilotMessage">
        <p>Real answer</p>
      </article>
    `;

    const result = extractM365Messages();

    expect(result.totalMessages).toBe(1);
    expect(result.messages[0].type).toBe('assistant');
    expect(result.messages[0].text).toBe('Real answer');
  });

  it('dedupes adjacent identical assistant snapshots', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-CopilotMessage">
        <p>Repeated response</p>
      </article>
      <article role="article" class="fai-CopilotMessage">
        <p>Repeated response</p>
      </article>
      <article role="article" class="fai-UserMessage">
        <p>You said: next prompt</p>
      </article>
      <article role="article" class="fai-CopilotMessage">
        <p>Repeated response</p>
      </article>
    `;

    const result = extractM365Messages();

    expect(result.messages.map((message) => message.text)).toEqual([
      'Repeated response',
      'next prompt',
      'Repeated response',
    ]);
    expect(result.messages.map((message) => message.index)).toEqual([0, 1, 2]);
  });

  it('prefers M365 message content containers over the whole article text', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-UserMessage">
        <h5 class="fai-UserMessage__accessibleHeading">You said:</h5>
        <button class="fai-UserMessage__actionBarAccessibleButton">More actions</button>
        <div class="fai-UserMessage__message">
          <div>User body only</div>
        </div>
      </article>
      <article role="article" class="fai-CopilotMessage">
        <div>
          <h6 class="fai-CopilotMessage__accessibleHeading">Copilot said:</h6>
          <div class="fai-CopilotMessage__name">Copilot</div>
        </div>
        <div class="fai-CopilotMessage__content">
          <p>Assistant body only</p>
        </div>
      </article>
    `;

    const result = extractM365Messages();

    expect(result.messages.map((message) => message.text)).toEqual([
      'User body only',
      'Assistant body only',
    ]);
  });

  it('preserves basic assistant HTML structure as Markdown text', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-CopilotMessage">
        <div class="fai-CopilotMessage__content">
          <p><strong>Copilot 正常工作中</strong></p>
          <p>如果你接下来想测试的是：</p>
          <ul>
            <li>指令是否被正确理解</li>
            <li>中文/英文混合输入</li>
          </ul>
          <p>可以继续输入。</p>
        </div>
      </article>
    `;

    const result = extractM365Messages();

    expect(result.totalMessages).toBe(1);
    expect(result.messages[0].text).toBe(
      [
        '**Copilot 正常工作中**',
        '如果你接下来想测试的是：',
        ['- 指令是否被正确理解', '- 中文/英文混合输入'].join('\n'),
        '可以继续输入。',
      ].join('\n\n'),
    );
  });

  it('preserves code, safe links, and semantic tables as Markdown text', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-CopilotMessage">
        <div class="fai-CopilotMessage__content">
          <p>Use <code>npm.cmd test</code> for the focused run.</p>
          <p>See <a href="https://learn.microsoft.com/microsoft-365/">M365 docs</a> and <a href="javascript:alert(1)">unsafe docs</a>.</p>
          <pre><code>const ok = true;
console.log(ok);</code></pre>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>JSON | Markdown</td>
                <td>Ready</td>
              </tr>
              <tr>
                <td>PDF</td>
                <td>Deferred</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    `;

    const result = extractM365Messages();

    expect(result.totalMessages).toBe(1);
    expect(result.messages[0].text).toBe(
      [
        'Use `npm.cmd test` for the focused run.',
        'See [M365 docs](https://learn.microsoft.com/microsoft-365/) and unsafe docs.',
        ['```', 'const ok = true;', 'console.log(ok);', '```'].join('\n'),
        [
          '| Name | Status |',
          '| --- | --- |',
          '| JSON \\| Markdown | Ready |',
          '| PDF | Deferred |',
        ].join('\n'),
      ].join('\n\n'),
    );
  });

  it('normalizes M365 code block fragments into fenced Markdown', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-CopilotMessage">
        <div class="fai-CopilotMessage__content">
          <div>JSON</div>
          <div>{<br />"status": "ok"<br />}</div>
          <div>\`\`</div>
          <code>const ready = true;
console.log(ready);</code>
        </div>
      </article>
    `;

    const result = extractM365Messages();

    expect(result.totalMessages).toBe(1);
    expect(result.messages[0].text).toBe(
      [
        ['```json', '{', '"status": "ok"', '}', '```'].join('\n'),
        ['```', 'const ready = true;', 'console.log(ready);', '```'].join('\n'),
      ].join('\n\n'),
    );
  });

  it('normalizes M365 language-labeled assistant code text into fenced Markdown', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-CopilotMessage">
        <div class="fai-CopilotMessage__content">
          <p>以下为示例：</p>
          <div>JSON</div>
          <div>{</div>
          <div>"status": "ok",</div>
          <div>"format": "export-test"</div>
          <div>}</div>
          <table>
            <tr>
              <th>列 A</th>
              <th>列 B</th>
            </tr>
            <tr>
              <td>JSON | Markdown</td>
              <td>示例文本</td>
            </tr>
          </table>
        </div>
      </article>
    `;

    const result = extractM365Messages();

    expect(result.totalMessages).toBe(1);
    expect(result.messages[0].text).toBe(
      [
        '以下为示例：',
        ['```json', '{', '"status": "ok",', '"format": "export-test"', '}', '```'].join('\n'),
        ['| 列 A | 列 B |', '| --- | --- |', '| JSON \\| Markdown | 示例文本 |'].join('\n'),
      ].join('\n\n'),
    );
  });

  it('removes assistant chrome, chain-of-thought controls, and feedback actions from extracted text', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-CopilotMessage">
        <div class="fai-CopilotMessage__content">
          <div class="scc-ChainOfThought">
            <button>2 ?????</button>
          </div>
          <p>Clean answer</p>
          <button>???? BizChat ???</button>
          <div class="someFeedbackContainer">Feedback text</div>
        </div>
      </article>
    `;

    const result = extractM365Messages();

    expect(result.totalMessages).toBe(1);
    expect(result.messages[0].text).toBe('Clean answer');
  });

  it('builds a CanonicalConversation as the shared M365 message index', () => {
    document.body.innerHTML = `
      <main>
        <article role="article" class="fai-UserMessage">
          <div class="fai-UserMessage__message">You said: first prompt</div>
        </article>
        <article role="article" class="fai-CopilotMessage">
          <div class="fai-CopilotMessage__content">
            <p>First answer</p>
            <p>continued answer</p>
          </div>
          <div class="fai-CopilotMessage nested-shell">
            <button>Copy</button>
          </div>
        </article>
        <article role="article" class="fai-UserMessage">
          <div class="fai-UserMessage__message">You said:</div>
        </article>
        <article role="article" class="fai-UserMessage">
          <div class="fai-UserMessage__message">You said: second prompt</div>
        </article>
        <article role="article" class="fai-CopilotMessage">
          <div class="fai-CopilotMessage__content">Second answer</div>
        </article>
      </main>
    `;

    const conversation = extractM365CanonicalConversation();

    expect(conversation.totalMessages).toBe(4);
    expect(conversation.userMessages).toBe(2);
    expect(conversation.assistantMessages).toBe(2);
    expect(conversation.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(conversation.messages.map((message) => message.text)).toEqual([
      'first prompt',
      'First answer\n\ncontinued answer',
      'second prompt',
      'Second answer',
    ]);
    expect(conversation.rawStats.logicalCandidateCount).toBe(5);
    expect(conversation.messages.map((message) => message.index)).toEqual([0, 1, 2, 3]);
    expect(new Set(conversation.messages.map((message) => message.id)).size).toBe(4);
    expect(
      conversation.messages.every(
        (message, index) =>
          message.id.startsWith(`m365:${index}:`) && message.fingerprint.length > 0,
      ),
    ).toBe(true);
  });

  it('keeps the legacy extractor facade backed by CanonicalConversation', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-UserMessage">
        <div class="fai-UserMessage__message">You said: facade prompt</div>
      </article>
      <article role="article" class="fai-CopilotMessage">
        <div class="fai-CopilotMessage__content">facade answer</div>
      </article>
    `;

    const canonical = extractM365CanonicalConversation();
    const legacy = extractM365Messages();

    expect(legacy.totalMessages).toBe(canonical.totalMessages);
    expect(legacy.messages.map((message) => message.id)).toEqual(
      canonical.messages.map((message) => message.id),
    );
    expect(legacy.messages.map((message) => message.type)).toEqual(['user', 'assistant']);
    expect(legacy.messages.map((message) => message.text)).toEqual([
      'facade prompt',
      'facade answer',
    ]);
  });

  it('keeps image-only messages and counts content images', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-CopilotMessage">
        <div class="fai-CopilotMessage__content">
          <img
            src="https://example.test/generated.png"
            alt="Generated chart"
            title="Quarterly chart"
            width="640"
            height="480"
          />
        </div>
      </article>
    `;

    const image = document.querySelector('img');
    Object.defineProperty(image, 'currentSrc', {
      configurable: true,
      value: 'https://cdn.example.test/generated-current.png',
    });
    Object.defineProperty(image, 'naturalWidth', {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(image, 'naturalHeight', {
      configurable: true,
      value: 960,
    });

    const conversation = extractM365CanonicalConversation();

    expect(conversation.totalMessages).toBe(1);
    expect(conversation.totalImages).toBe(1);
    expect(conversation.messages[0].text).toBe('');
    expect(conversation.messages[0].imageCount).toBe(1);
    expect(conversation.messages[0].content).toEqual([
      expect.objectContaining({
        kind: 'image',
        src: 'https://example.test/generated.png',
        currentSrc: 'https://cdn.example.test/generated-current.png',
        alt: 'Generated chart',
        title: 'Quarterly chart',
        width: 640,
        height: 480,
        naturalWidth: 1280,
        naturalHeight: 960,
      }),
    ]);
  });

  it('ignores small inline icons while preserving content images', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-CopilotMessage">
        <div class="fai-CopilotMessage__content">
          <p>Answer with an image</p>
          <img src="https://example.test/icon.svg" alt="icon" width="16" height="16" />
          <img src="https://example.test/photo.png" alt="photo" width="800" height="600" />
        </div>
      </article>
    `;

    const result = extractM365Messages();

    expect(result.totalImages).toBe(1);
    expect(result.messages[0].imageCount).toBe(1);
    expect(result.messages[0].content).toContainEqual(
      expect.objectContaining({
        kind: 'image',
        src: 'https://example.test/photo.png',
        alt: 'photo',
      }),
    );
  });

  it('falls back to article nodes when M365 message classes are unavailable', () => {
    document.body.innerHTML = `
      <article role="article">
        <p>You said: fallback prompt</p>
      </article>
      <article role="article">
        <p>fallback answer</p>
      </article>
    `;

    const result = extractM365Messages();

    expect(result.totalMessages).toBe(2);
    expect(result.messages.map((message) => message.type)).toEqual(['user', 'assistant']);
    expect(result.messages.map((message) => message.text)).toEqual([
      'fallback prompt',
      'fallback answer',
    ]);
  });

  it('keeps canonical ids stable across repeated extraction of the same DOM state', () => {
    document.body.innerHTML = `
      <article role="article" class="fai-UserMessage">
        <div class="fai-UserMessage__message">You said: stable prompt</div>
      </article>
      <article role="article" class="fai-CopilotMessage">
        <div class="fai-CopilotMessage__content">stable answer</div>
      </article>
    `;

    const first = extractM365CanonicalConversation();
    const second = extractM365CanonicalConversation();

    expect(second.messages.map((message) => message.id)).toEqual(
      first.messages.map((message) => message.id),
    );
    expect(second.messages.map((message) => message.fingerprint)).toEqual(
      first.messages.map((message) => message.fingerprint),
    );
  });

  it('uses a stable default title for M365 debug Markdown export', () => {
    document.title = 'User prompt should not become export title';
    document.body.innerHTML = `
      <article role="article" class="fai-CopilotMessage">
        <div class="fai-CopilotMessage__content">stable answer</div>
      </article>
    `;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    startM365ChatExtractor();
    const result = (
      window as unknown as {
        __gvExportM365Markdown: () => { filename: string; markdown: string };
      }
    ).__gvExportM365Markdown();

    expect(result.filename).toMatch(/^m365-copilot-/);
    expect(result.markdown).toContain('# M365 Copilot');
    expect(result.markdown).not.toContain('User prompt should not become export title');
  });
});
