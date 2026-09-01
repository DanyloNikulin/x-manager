import { describe, expect, it } from 'vitest';
import { parseCommissionPressCornerPayload } from '../../src/lib/create-thread';

describe('Commission Press Corner extraction', () => {
  it('extracts the article body and quotes from the document API payload', () => {
    const article = parseCommissionPressCornerPayload({
      globalImg: 'https://ec.europa.eu/image.jpg',
      docuLanguageResource: {
        title: 'Commission announces a designation*',
        subtitle: 'Commission announcement',
        htmlContent: [
          '<p>The services declared that they reach at least 45 million average monthly users in the EU.</p>',
          '<p>They have four months to comply with the additional obligations in the regulation.</p>',
          '<p>Coimisi&uacute;n na Me&aacute;n is the Irish regulator.</p>',
        ].join(''),
        dolaQuoteResources: [
          { extract: 'The designation creates a higher standard of scrutiny and accountability.' },
        ],
        dolaAvResources: [],
      },
    }, 'https://ec.europa.eu/commission/presscorner/detail/en/ip_26_1772');

    expect(article).not.toBeNull();
    expect(article?.excerpt).toContain('45 million');
    expect(article?.excerpt).toContain('four months');
    expect(article?.excerpt).toContain('Coimisiún na Meán');
    expect(article?.quoteCandidates[0]).toContain('higher standard');
    expect(article?.imageUrls).toEqual(['https://ec.europa.eu/image.jpg']);
  });

  it('rejects an incomplete API payload', () => {
    expect(parseCommissionPressCornerPayload({}, 'https://ec.europa.eu/example')).toBeNull();
  });
});
