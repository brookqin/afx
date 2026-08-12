import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('公共首页', () => {
  it('使用统一布局并支持查询参数语言切换', async () => {
    const page = await SELF.fetch('http://localhost/?lang=zh-CN');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-language')).toBe('zh-CN');
    expect(page.headers.get('vary')).toContain('Accept-Language');

    const html = await page.text();
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('临时文件交换');
    expect(html).toContain('class="home-grid"');
    expect(html).toContain('Agent File Exchange v0.3.0');
    expect(html).toContain('https://github.com/brookqin/afx');

    const english = await SELF.fetch('http://localhost/?lang=en');
    expect(english.headers.get('content-language')).toBe('en');
    expect(await english.text()).toContain('Temporary file exchange');
  });
});
