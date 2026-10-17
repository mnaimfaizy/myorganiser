import type { CSSProperties } from 'react';

// Ciphertext stand-in glyphs. Each plaintext glyph has one, and the stage scrambles
// between them on scroll.
const CIPHER_GLYPHS = '#@*&%$+?!=~<>^/|\\';

interface CipherHeadlineProps {
  text: string;
}

/**
 * The stage headline. Each glyph stacks its plaintext over a ciphertext stand-in,
 * and words never break mid-word. The accessible name is the plaintext: the glyph
 * spans are hidden from assistive technology and the sr-only copy carries the text.
 */
export function CipherHeadline({ text }: CipherHeadlineProps) {
  const words = text.split(' ');
  let glyphIndex = 0;
  return (
    <h1 className="text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl">
      <span className="sr-only">{text}</span>
      {words.map((word, wordIndex) => {
        const isLast = wordIndex === words.length - 1;
        const characters = Array.from(isLast ? word : `${word} `);
        return (
          <span
            key={`${wordIndex}-${word}`}
            aria-hidden="true"
            className="inline-block whitespace-nowrap"
          >
            {characters.map((character) => {
              const index = glyphIndex;
              glyphIndex += 1;
              const plain = character === ' ' ? ' ' : character;
              const cipher =
                character === ' '
                  ? ' '
                  : CIPHER_GLYPHS[(index * 7) % CIPHER_GLYPHS.length];
              return (
                <span
                  key={index}
                  className="lp-glyph"
                  style={{ '--i': index } as CSSProperties}
                >
                  <span className="lp-plain">{plain}</span>
                  <span className="lp-cipher">{cipher}</span>
                </span>
              );
            })}
          </span>
        );
      })}
    </h1>
  );
}
