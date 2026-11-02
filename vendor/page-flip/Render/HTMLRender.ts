// @ts-nocheck
import { Orientation, Render } from './Render';
import { PageFlip } from '../PageFlip';
import { FlipDirection } from '../Flip/Flip';
import { Page, PageDensity, PageOrientation } from '../Page/Page';
import { HTMLPage, setStyle } from '../Page/HTMLPage';
import { Helper } from '../Helper';
import { FlipSetting } from '../Settings';
import { Point } from '../BasicTypes';

const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

/** [modified] a warm grey that matches the paper (#fbf8f1) instead of a neutral one */
const warm = (g: number, a: number) => `rgba(${Math.min(255, g + 4)}, ${g}, ${Math.max(0, g - 8)}, ${a})`;

/**
 * [modified] Gradients of the light and shadow layers while a page turns, rebuilt from the values measured on
 * FlipHTML5 (spec T6). Each starts at the fold line.
 */
// A: shadow on the uncovered page (60px wide before scaling, from the fold line on)
const SHADOW_A = `linear-gradient(to right, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.922) 11.7%, rgba(0, 0, 0, 0.796) 25%,
    rgba(0, 0, 0, 0.667) 36.7%, rgba(0, 0, 0, 0.498) 50%, rgba(0, 0, 0, 0.357) 61.7%, rgba(0, 0, 0, 0.204) 75%,
    rgba(0, 0, 0, 0.09) 86.7%, rgba(0, 0, 0, 0.008) 98.3%, rgba(0, 0, 0, 0) 100%)`;
// B: grey shade on the turning sheet (260px), dark at the fold, a touch of white at 63%
const SHADOW_B = `linear-gradient(to right, ${warm(103, 1)} 0%, ${warm(128, 0.875)} 12.7%, ${warm(167, 0.675)} 25.4%,
    ${warm(207, 0.46)} 37.6%, ${warm(240, 0.25)} 50.3%, rgba(255, 255, 255, 0.1) 63%, rgba(255, 255, 255, 0) 75%)`;
// C: dark crease along the fold (5px from the fold line on). On screen FlipHTML5's crease shades the first four
// pixels of the sheet by 6%, 11%, 7% and 1% (at its opacity 0.5). Smooth, so it looks the same however the browser
// samples it
const SHADOW_C = `linear-gradient(to right, rgba(30, 30, 30, 0.1) 0, rgba(30, 30, 30, 0.138) 1px,
    rgba(30, 30, 30, 0.249) 2px, rgba(30, 30, 30, 0.15) 3px, rgba(30, 30, 30, 0.02) 4px, rgba(30, 30, 30, 0) 5px)`;
// D: narrow highlight (18px, right after the crease, brightest 4.5px in)
const SHADOW_D = `linear-gradient(to right, ${warm(203, 0.235)} 0.5px, ${warm(245, 0.878)} 2.5px,
    rgba(255, 255, 255, 0.988) 4.5px, rgba(255, 255, 255, 0.702) 6.5px, ${warm(243, 0.6)} 8.5px,
    ${warm(217, 0.416)} 11.5px, ${warm(198, 0.29)} 13.5px, ${warm(181, 0.176)} 15.5px, ${warm(170, 0.102)} 17.5px)`;
// E: wide white gloss (78px, 23px from the fold, both scaled like B)
const SHADOW_E = `linear-gradient(to right, rgba(255, 255, 255, 0.016) 0%, rgba(255, 255, 255, 0.243) 12.5%,
    rgba(255, 255, 255, 0.561) 25%, rgba(255, 255, 255, 0.855) 37.5%, rgba(255, 255, 255, 0.996) 50%,
    rgba(255, 255, 255, 0.89) 62.5%, rgba(255, 255, 255, 0.588) 75%, rgba(255, 255, 255, 0.251) 87.5%,
    rgba(255, 255, 255, 0.008) 100%)`;

/**
 * Class responsible for rendering the HTML book
 */
export class HTMLRender extends Render {
    /** Parent HTML Element */
    private readonly element: HTMLElement;

    /** Pages List as HTMLElements */
    private readonly items: NodeListOf<HTMLElement> | HTMLElement[];

    /** [modified] light and shadow layers A–F of a turning soft page (drawSoftShadows) */
    private softShadows: Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f', HTMLElement> = null;
    private hardShadow: HTMLElement = null;
    private hardInnerShadow: HTMLElement = null;
    /** [modified] Edges of the stacked pages on both sides of the book (thickness of the book) */
    private stackLeft: HTMLElement = null;
    private stackRight: HTMLElement = null;
    /** [modified] pages the next turn may show (and, one page at a time, the back-side copies of the current and the
     * previous page), kept laid out and painted under the shown page so the turn does not start with that work */
    private warmPages: Page[] = [];
    private warmCopies: Page[] = [];
    private warmKey = '';
    private warmTimer = 0;
    /** [modified] pages whose words are shaped ahead (shapeAhead), with the page width they were shaped at */
    private shaped = new Map<Page, number>();
    /** [modified] the page being shaped now: a hidden copy of it, and its texts with the words still to shape */
    private shaping: { page: Page; width: number; shell: HTMLElement; texts: [Text, string[]][] } | null = null;

    /**
     * @constructor
     *
     * @param {PageFlip} app - PageFlip object
     * @param {FlipSetting} setting - Configuration object
     * @param {HTMLElement} element - Parent HTML Element
     */
    constructor(app: PageFlip, setting: FlipSetting, element: HTMLElement) {
        super(app, setting);

        this.element = element;

        this.createShadows();
    }

    private createShadows(): void {
        this.element.insertAdjacentHTML(
            'beforeend',
            `<div class="stf__shadow stf__shadowA"></div>
             <div class="stf__shadow stf__shadowB"></div>
             <div class="stf__shadow stf__shadowC"></div>
             <div class="stf__shadow stf__shadowD"></div>
             <div class="stf__shadow stf__shadowE"></div>
             <div class="stf__shadow stf__shadowF"></div>
             <div class="stf__hardShadow"></div>
             <div class="stf__hardInnerShadow"></div>
             <div class="stf__stack stf__stackLeft"></div>
             <div class="stf__stack stf__stackRight"></div>`
        );

        this.softShadows = {
            a: this.element.querySelector('.stf__shadowA'),
            b: this.element.querySelector('.stf__shadowB'),
            c: this.element.querySelector('.stf__shadowC'),
            d: this.element.querySelector('.stf__shadowD'),
            e: this.element.querySelector('.stf__shadowE'),
            f: this.element.querySelector('.stf__shadowF'),
        };
        this.hardShadow = this.element.querySelector('.stf__hardShadow');
        this.hardInnerShadow = this.element.querySelector('.stf__hardInnerShadow');
        this.stackLeft = this.element.querySelector('.stf__stackLeft');
        this.stackRight = this.element.querySelector('.stf__stackRight');
    }

    /**
     * [modified] The first and last page shown now (two-page layout: the static spread; one page: the current page,
     * the static page is swapped while the previous page folds open), null if none
     */
    private shownPages(): [number, number] | null {
        const pages = this.app.getPageCollection().getPages();

        if (this.orientation === Orientation.PORTRAIT) {
            const index = this.app.getCurrentPageIndex();
            return [index, index];
        }

        const shown = [this.leftPage, this.rightPage].map((p) => pages.indexOf(p)).filter((i) => i >= 0);
        return shown.length === 0 ? null : [Math.min(...shown), Math.max(...shown)];
    }

    /**
     * [modified] The spread a page turn ends on (two-page layout), null without a turn. The turning sheet lands on
     * the far side; the page under it is the other one (none when the sheet is the back cover or the cover).
     */
    private turnTarget(): [number, number] | null {
        if (this.orientation === Orientation.PORTRAIT || this.flippingPage === null) return null;

        const pages = this.app.getPageCollection().getPages();
        const sheet = pages.indexOf(this.flippingPage);
        const under = this.bottomPage !== this.flippingPage ? pages.indexOf(this.bottomPage) : -1;
        const shown = [sheet, under].filter((i) => i >= 0);

        return shown.length === 0 ? null : [Math.min(...shown), Math.max(...shown)];
    }

    /**
     * [modified] Thickness of the book (spec T7): T = 20·(1 − (1 − min(N, 100)/100)²) px in all, shared by the two
     * sides in proportion to the pages before and after the shown ones. It changes when a turn ends. A closed book
     * (the cover or the back cover alone) is pressed to about 4px and opens / closes along with the cover turn.
     * An upright one-page layout (phone) gets at most 10px, drawn in its 10px side margins.
     */
    private drawStacks(): void {
        const total = this.app.getPageCollection().getPages().length;
        const rect = this.getRect(); // this.upright is measured with the book area
        const portrait = this.orientation === Orientation.PORTRAIT;
        const shown = this.shownPages();

        if (total < 2 || shown === null) {
            setStyle(this.stackLeft, 'display: none');
            setStyle(this.stackRight, 'display: none');
            return;
        }

        const max = portrait && this.upright ? 10 : 20;
        const full = max * (1 - Math.pow(1 - Math.min(total, 100) / 100, 2));
        const closed = ([first, last]: [number, number]) => !portrait && (last === 0 || first === total - 1);
        /** [left, right]: the full thickness and the shown part of it (pressed to ~4px when closed) */
        const sides = (spread: [number, number]) => {
            const before = spread[0];
            const after = total - 1 - spread[1];
            const left = before + after > 0 ? (full * before) / (before + after) : 0;
            const k = closed(spread) ? Math.min(1, 4 / (full + 1)) : 1;
            return [
                { full: left, shown: left * k },
                { full: full - left, shown: (full - left) * k },
            ];
        };

        const now = sides(shown);

        // turning the cover open or shut: the thickness follows the turn (the same curve as the book's move)
        const target = this.turnTarget();
        if (target !== null && closed(target) !== closed(shown)) {
            const next = sides(target);
            const ease = easeInOutSine(this.flipProgress);
            for (const i of [0, 1]) {
                now[i].shown += (next[i].shown - now[i].shown) * ease;
                now[i].full = Math.max(now[i].full, next[i].full);
            }
        }

        // only beside a shown page (while the cover opens, the left side has no page yet)
        if (!portrait && this.leftPage === null) now[0].shown = 0;
        if (!portrait && this.rightPage === null) now[1].shown = 0;

        const pageLeft = portrait ? rect.left + rect.pageWidth : rect.left;
        const pageRight = rect.left + rect.width;
        const common = `top: ${rect.top + 1}px; height: ${rect.height - 2}px;`;

        const leftStyle = `${common} left: ${pageLeft - now[0].full}px;`;
        this.drawStack(this.stackLeft, now[0].full, now[0].shown, leftStyle, 'to left');
        this.drawStack(this.stackRight, now[1].full, now[1].shown, `${common} left: ${pageRight}px;`, 'to right');
    }

    /**
     * [modified] One side of the thickness: page lines like FlipHTML5 (from the page outward: a light line, thin
     * lines that alternate, then three bands that get darker), in the paper's warm tone. A pressed (closed) book
     * squeezes the same lines.
     */
    private drawStack(element: HTMLElement, full: number, shown: number, position: string, outward: string): void {
        if (shown < 0.05) {
            setStyle(element, 'display: none');
            return;
        }

        // 19px measured: 1px light, 7px alternating, then 4px, 4px and 3px bands. Thinner books keep the proportions.
        const tone = (g: number) => `rgb(${g}, ${g - 3}, ${g - 10})`;
        const bands = (full * 11) / 19;
        const alternate = full - 1 - bands;
        const stops = [`${tone(243)} 0 1px`];
        let x = 1;
        for (let i = 0; x < 1 + alternate - 0.01; i++) {
            const end = Math.min(1 + alternate, x + 1);
            stops.push(`${tone(i % 2 === 0 ? 209 : 231)} ${x.toFixed(2)}px ${end.toFixed(2)}px`);
            x = end;
        }
        for (const [g, part] of [[213, 4], [207, 4], [201, 3]]) {
            const end = x + (bands * part) / 11;
            stops.push(`${tone(g)} ${x.toFixed(2)}px ${end.toFixed(2)}px`);
            x = end;
        }

        setStyle(
            element,
            `${position} width: ${full}px; background: linear-gradient(${outward}, ${stops.join(', ')});` +
                (shown < full - 0.01 ? ` transform: scaleX(${shown / full});` : '')
        );
    }

    /**
     * [modified] The book moves to the middle of its area while the cover or the back cover is shown alone
     * (two-page layout, FlipHTML5). The move follows the turn: ±W/2 × easeInOutSine(progress).
     */
    private drawBookShift(): void {
        let shift = 0;

        if (this.orientation === Orientation.LANDSCAPE) {
            const total = this.app.getPageCollection().getPages().length;
            const half = this.getRect().pageWidth / 2;
            const offset = (spread: [number, number] | null) =>
                spread === null ? 0 : spread[1] === 0 ? -half : spread[0] === total - 1 ? half : 0;

            shift = offset(this.shownPages());
            const target = this.turnTarget();
            if (target !== null) shift += (offset(target) - shift) * easeInOutSine(this.flipProgress);
        }

        setStyle(this.element, Math.abs(shift) < 0.01 ? '' : `transform: translateX(${shift.toFixed(2)}px);`);
    }

    public stop(): void {
        super.stop();
        window.clearTimeout(this.warmTimer); // [modified]
        this.warmTimer = 0;
        this.shaping?.shell.remove();
        this.shaping = null;
    }

    public clearShadow(): void {
        super.clearShadow();

        for (const layer of Object.values(this.softShadows)) setStyle(layer, 'display: none');
        this.hardShadow.style.cssText = 'display: none';
        this.hardInnerShadow.style.cssText = 'display: none';
    }

    public reload(): void {
        const testShadow = this.element.querySelector('.stf__shadow');

        if (!testShadow) {
            this.createShadows();
        }
    }

    /**
     * Draw inner shadow to the hard page
     */
    private drawHardInnerShadow(): void {
        const rect = this.getRect();

        const progress =
            this.shadow.progress > 100 ? 200 - this.shadow.progress : this.shadow.progress;

        let innerShadowSize = ((100 - progress) * (2.5 * rect.pageWidth)) / 100 + 20;
        if (innerShadowSize > rect.pageWidth) innerShadowSize = rect.pageWidth;

        let newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 5).toString(10)};
            width: ${innerShadowSize}px;
            height: ${rect.height}px;
            background: linear-gradient(to right,
                rgba(0, 0, 0, ${(this.shadow.opacity * progress) / 100}) 5%,
                rgba(0, 0, 0, 0) 100%);
            left: ${rect.left + rect.width / 2}px;
            transform-origin: 0 0;
        `;

        newStyle +=
            (this.getDirection() === FlipDirection.FORWARD && this.shadow.progress > 100) ||
            (this.getDirection() === FlipDirection.BACK && this.shadow.progress <= 100)
                ? `transform: translate3d(0, 0, 0);`
                : `transform: translate3d(0, 0, 0) rotateY(180deg);`;

        this.hardInnerShadow.style.cssText = newStyle;
    }

    /**
     * Draw outer shadow to the hard page
     */
    private drawHardOuterShadow(): void {
        const rect = this.getRect();

        const progress =
            this.shadow.progress > 100 ? 200 - this.shadow.progress : this.shadow.progress;

        let shadowSize = ((100 - progress) * (2.5 * rect.pageWidth)) / 100 + 20;
        if (shadowSize > rect.pageWidth) shadowSize = rect.pageWidth;

        let newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 4).toString(10)};
            width: ${shadowSize}px;
            height: ${rect.height}px;
            background: linear-gradient(to left, rgba(0, 0, 0, ${
                this.shadow.opacity
            }) 5%, rgba(0, 0, 0, 0) 100%);
            left: ${rect.left + rect.width / 2}px;
            transform-origin: 0 0;
        `;

        newStyle +=
            (this.getDirection() === FlipDirection.FORWARD && this.shadow.progress > 100) ||
            (this.getDirection() === FlipDirection.BACK && this.shadow.progress <= 100)
                ? `transform: translate3d(0, 0, 0) rotateY(180deg);`
                : `transform: translate3d(0, 0, 0);`;

        this.hardShadow.style.cssText = newStyle;
    }

    /**
     * [modified] Light and shadow while a soft page turns, as measured on FlipHTML5 (spec T6). Strips lie along the
     * fold line, each clipped to the paper it falls on, so nothing leaks out of the book:
     * A on the uncovered page; B grey shade, C dark crease, D narrow highlight and E wide gloss on the turning sheet;
     * F the sheet's soft edge on the pages under it.
     * Widths are fixed px (A widens with the turn, B and E grow with the fold). The opacity follows the envelope e:
     * 0 → 1 over the first 10% of the turn, 1 → 0 over the last 10%.
     */
    private drawSoftShadows(): void {
        const layers = this.softShadows;
        const rect = this.getRect();
        const toGlobal = (p: Point) => this.convertToGlobal(p);

        const corner = toGlobal(this.shadow.corner);
        const origin = toGlobal(this.shadow.origin);
        const length = Math.hypot(origin.x - corner.x, origin.y - corner.y);
        if (length < 0.5) {
            for (const layer of Object.values(layers)) setStyle(layer, 'display: none');
            return;
        }

        // u: from the fold line into the turning sheet, v: along the fold line
        const u = { x: (corner.x - origin.x) / length, y: (corner.y - origin.y) / length };
        const v = { x: -u.y, y: u.x };
        const fold = { x: (corner.x + origin.x) / 2, y: (corner.y + origin.y) / 2 };
        const d = length / 2; // from the fold line to the corner

        // the uncovered part of the page, and the turning sheet (that part folded over the line). Both reach 1px over
        // the fold line, where the strips' own edges end them: cut there twice, the fold pixel showed as a light line
        const page = [
            toGlobal({ x: 0, y: 0 }),
            toGlobal({ x: rect.pageWidth, y: 0 }),
            toGlobal({ x: rect.pageWidth, y: rect.height }),
            toGlobal({ x: 0, y: rect.height }),
        ];
        const uncovered = Helper.ClipPolygonByHalfPlane(page, { x: fold.x + u.x, y: fold.y + u.y }, { x: -u.x, y: -u.y });
        const sheet = uncovered.map((p) => {
            const k = 2 * ((p.x - fold.x) * u.x + (p.y - fold.y) * u.y);
            return { x: p.x - k * u.x, y: p.y - k * u.y };
        });

        // the shadow's progress trails the corner's a little: at the same pose FlipHTML5 measured 0.302, 0.469, 0.721
        // and 0.917 where the corner had gone 0.330, 0.501, 0.750 and 0.933 of the way, i.e. the corner progress
        // of 0.35 of its 18 steps earlier on the same easeInOutSine path
        const step = Math.acos(1 - 2 * Math.min(1, this.flipProgress)) / Math.PI; // the inverse of easeInOutSine
        const t = easeInOutSine(Math.max(0, step - 0.35 / 18));
        const e = Math.max(0, Math.min(1, Math.min(t, 1 - t) / 0.1));
        const max = this.getSettings().maxShadowOpacity;
        const widen = t > 0.9 ? 1 + (2 * (1 - t)) / 0.1 : (3 * t) / 0.9; // 0 → 3 → 1
        const grow = Math.min(1, d / 260);
        const sheetOpacity = (d <= 260 ? (0.34 * d) / 260 : 0.34 * e) * max;
        const z = this.getSettings().startZIndex + 10;

        /**
         * a strip from a to b px across the fold line, clipped to the polygon. The strip's x axis is "across": u into
         * the sheet, or −u into the uncovered page. A strip that touches the fold starts there (a = 0): its edge on the
         * fold line then lies on a whole pixel of the strip, otherwise that pixel was drawn about 0.3px short.
         */
        const strip = (
            layer: HTMLElement,
            a: number,
            b: number,
            clip: Point[],
            background: string,
            opacity: number,
            across = u
        ) => {
            if (b - a < 0.01 || opacity < 0.001 || clip.length < 3) {
                setStyle(layer, 'display: none');
                return;
            }

            const along = { x: -across.y, y: across.x };
            // long enough to cover the fold line across the whole polygon
            let half = 2;
            for (const p of clip) half = Math.max(half, Math.abs((p.x - fold.x) * v.x + (p.y - fold.y) * v.y) + 2);
            const o = { x: fold.x + a * across.x - half * along.x, y: fold.y + a * across.y - half * along.y };

            setStyle(
                layer,
                `display: block; z-index: ${z}; width: ${b - a}px; height: ${2 * half}px; ` +
                    `opacity: ${opacity.toFixed(3)}; background: ${background}; transform-origin: 0 0; ` +
                    `transform: matrix(${across.x}, ${across.y}, ${along.x}, ${along.y}, ${o.x}, ${o.y}); ` +
                    `clip-path: ${this.localPolygon(clip, o, across, along)};`
            );
        };

        strip(layers.a, 0, 60 * widen, uncovered, SHADOW_A, 0.3 * e * max, { x: -u.x, y: -u.y });
        // B begins 0.4px after the fold line: on FlipHTML5's screen the fold pixel and the one after it are lighter
        strip(layers.b, 0.4, 0.4 + 260 * grow, sheet, SHADOW_B, sheetOpacity);
        strip(layers.c, 0, 5, sheet, SHADOW_C, 0.5 * e * max);
        strip(layers.d, 3, 21, sheet, SHADOW_D, 0.34 * e * max);
        strip(layers.e, 23 * grow, 101 * grow, sheet, SHADOW_E, sheetOpacity);

        // F: the turning page's soft edge (box-shadow 0 0 3px), only on the sheet's side of the fold and on the
        // pages of the book
        const topLeft = toGlobal(this.pageRect.topLeft);
        const topRight = toGlobal(this.pageRect.topRight);
        const bottomLeft = toGlobal(this.pageRect.bottomLeft);
        const width = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
        const height = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
        const ex = { x: (topRight.x - topLeft.x) / width, y: (topRight.y - topLeft.y) / width };
        const ey = { x: (bottomLeft.x - topLeft.x) / height, y: (bottomLeft.y - topLeft.y) / height };

        const portrait = this.orientation === Orientation.PORTRAIT;
        const left = rect.left + (portrait || this.leftPage === null ? rect.pageWidth : 0);
        const right = rect.left + (!portrait && this.rightPage === null ? rect.pageWidth : rect.width);
        const book = [
            { x: left, y: rect.top },
            { x: right, y: rect.top },
            { x: right, y: rect.top + rect.height },
            { x: left, y: rect.top + rect.height },
        ];
        const below = right > left ? Helper.ClipPolygonByHalfPlane(book, fold, u) : [];

        if (below.length < 3) {
            setStyle(layers.f, 'display: none');
        } else {
            setStyle(
                layers.f,
                `display: block; z-index: ${z}; width: ${width}px; height: ${height}px; ` +
                    `box-shadow: 0 0 3px rgba(40, 40, 40, ${0.2 * max}); transform-origin: 0 0; ` +
                    `transform: matrix(${ex.x}, ${ex.y}, ${ey.x}, ${ey.y}, ${topLeft.x}, ${topLeft.y}); ` +
                    `clip-path: ${this.localPolygon(below, topLeft, ex, ey)};`
            );
        }
    }

    /** [modified] clip-path polygon of global points, in the frame of an element at o with unit axes ex, ey */
    private localPolygon(points: Point[], o: Point, ex: Point, ey: Point): string {
        const local = points.map((p) => {
            const dx = p.x - o.x;
            const dy = p.y - o.y;
            return `${(dx * ex.x + dy * ex.y).toFixed(2)}px ${(dx * ey.x + dy * ey.y).toFixed(2)}px`;
        });

        return `polygon(${local.join(', ')})`;
    }

    /**
     * Draw left static page
     */
    private drawLeftPage(): void {
        if (this.orientation === Orientation.PORTRAIT || this.leftPage === null) return;

        if (
            this.direction === FlipDirection.BACK &&
            this.flippingPage !== null &&
            this.flippingPage.getDrawingDensity() === PageDensity.HARD
        ) {
            (this.leftPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 5
            ).toString(10);

            this.leftPage.setHardDrawingAngle(180 + this.flippingPage.getHardAngle());
            this.leftPage.draw(this.flippingPage.getDrawingDensity());
        } else {
            this.leftPage.simpleDraw(PageOrientation.LEFT);
        }
    }

    /**
     * Draw right static page
     */
    private drawRightPage(): void {
        if (this.rightPage === null) return;

        if (
            this.direction === FlipDirection.FORWARD &&
            this.flippingPage !== null &&
            this.flippingPage.getDrawingDensity() === PageDensity.HARD
        ) {
            (this.rightPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 5
            ).toString(10);

            this.rightPage.setHardDrawingAngle(180 + this.flippingPage.getHardAngle());
            this.rightPage.draw(this.flippingPage.getDrawingDensity());
        } else {
            this.rightPage.simpleDraw(PageOrientation.RIGHT);
        }
    }

    /**
     * Draw the next page at the time of flipping
     */
    private drawBottomPage(): void {
        if (this.bottomPage === null) return;

        const tempDensity =
            this.flippingPage != null ? this.flippingPage.getDrawingDensity() : null;

        // [modified] the one-page back turn is drawn as a forward fold too, so the bottom page is always shown
        (this.bottomPage as HTMLPage).getElement().style.zIndex = (
            this.getSettings().startZIndex + 3
        ).toString(10);

        this.bottomPage.draw(tempDensity);
    }

    protected drawFrame(): void {
        this.clear();

        if (this.flippingPage === null) this.scheduleWarm();

        this.drawLeftPage();

        this.drawRightPage();

        this.drawBottomPage();

        this.drawStacks();

        this.drawBookShift();

        if (this.flippingPage != null) {
            (this.flippingPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 5
            ).toString(10);

            this.flippingPage.draw();
        }

        if (this.shadow != null && this.flippingPage !== null) {
            if (this.flippingPage.getDrawingDensity() === PageDensity.SOFT) {
                this.drawSoftShadows();
            } else {
                this.drawHardOuterShadow();
                this.drawHardInnerShadow();
            }
        }
    }

    private clear(): void {
        // [modified] the warm pages lie under a shown page
        const under = this.rightPage !== null ? PageOrientation.RIGHT : PageOrientation.LEFT;
        const portrait = this.orientation === Orientation.PORTRAIT;

        for (const page of this.app.getPageCollection().getPages()) {
            if (
                page !== this.leftPage &&
                page !== this.rightPage &&
                page !== this.flippingPage &&
                page !== this.bottomPage
            ) {
                if (this.warmPages.includes(page) && (this.leftPage !== null || this.rightPage !== null))
                    page.simpleDraw(under, true);
                else setStyle((page as HTMLPage).getElement(), 'display: none'); // [modified] only when it changes
            }

            if (page.getTemporaryCopy() !== this.flippingPage) {
                if (portrait && this.warmCopies.includes(page) && page.getTemporaryCopy() !== null)
                    page.getTemporaryCopy().simpleDraw(PageOrientation.RIGHT, true);
                else page.hideTemporaryCopy();
            }
        }
    }

    /**
     * [modified] Once the book rests after a turn, lay out the neighbouring pages ahead of time (FlipHTML5 has
     * pictures ready; text pages need layout and painting, which made the first frames of a turn long).
     * One page (or back-side copy) per step, the next forward turn's first. A new page's words are shaped first, a
     * few per step (shapeAhead): laid out at once, a page made one long frame (20–80ms) on a slow phone after
     * every turn. The steps start 100ms after the turn and follow each other 16ms apart.
     */
    private scheduleWarm(delay = 100): void {
        const shown = this.shownPages();
        const key = shown === null ? '' : `${this.orientation} ${shown.join('-')}`;
        if (key === this.warmKey || this.warmTimer !== 0) return;

        this.warmTimer = window.setTimeout(() => {
            this.warmTimer = 0;
            if (this.flippingPage !== null) {
                this.scheduleWarm(); // not while a page turns
                return;
            }

            const pages = this.app.getPageCollection().getPages();
            const now = this.shownPages();
            // the shown pages are laid out: their words are shaped
            if (now !== null) for (let i = now[0]; i <= now[1]; i++) this.shaped.set(pages[i], this.getRect().pageWidth);
            if (this.shaping !== null && this.shaped.get(this.shaping.page) === this.shaping.width) {
                this.shaping.shell.remove();
                this.shaping = null;
            }
            /** [page index, back-side copy] in the order they are laid out */
            const plan: [number, boolean][] =
                now === null
                    ? []
                    : this.orientation === Orientation.PORTRAIT
                      ? [[now[0] + 1, false], [now[0], true], [now[0] - 1, false], [now[0] - 1, true]]
                      : [[now[1] + 1, false], [now[1] + 2, false], [now[0] - 1, false], [now[0] - 2, false]];
            const steps = plan.filter(([i]) => i >= 0 && i < pages.length).map(([i, copy]) => [pages[i], copy] as const);

            // pages no longer near are dropped at once
            this.warmPages = this.warmPages.filter((p) => steps.some(([q, copy]) => q === p && !copy));
            this.warmCopies = this.warmCopies.filter((p) => steps.some(([q, copy]) => q === p && copy));

            const next = steps.find(([p, copy]) => !(copy ? this.warmCopies : this.warmPages).includes(p));
            if (next === undefined) this.warmKey = now === null ? '' : `${this.orientation} ${now.join('-')}`;
            else if (next[1]) {
                next[0].newTemporaryCopy();
                this.warmCopies.push(next[0]);
            } else if (!this.shapeAhead(next[0])) {
                this.scheduleWarm(16); // only words were shaped: nothing to draw yet
                return;
            } else this.warmPages.push(next[0]);
            if (next !== undefined) this.scheduleWarm(16);
            this.requestFrame(); // draws the step, or hides what was dropped
        }, delay);
    }

    /**
     * [modified] Shape the words of a page ahead, 12 per call, in a hidden copy of the page (2–5ms each on a slow
     * phone). The shaped words are kept, and the page itself then lays out in 1–2ms.
     *
     * @returns true once all of the page's words are shaped
     */
    private shapeAhead(page: Page): boolean {
        const rect = this.getRect();
        if (this.shaped.get(page) === rect.pageWidth) return true;

        if (this.shaping?.page !== page || this.shaping.width !== rect.pageWidth) {
            this.shaping?.shell.remove();
            const shell = (page as HTMLPage).getElement().cloneNode(true) as HTMLElement;
            shell.classList.remove('stf__item');
            shell.style.cssText =
                `position: fixed; left: -10000px; top: 0; width: ${rect.pageWidth}px; height: ${rect.height}px; ` +
                'visibility: hidden; pointer-events: none;';
            const texts: [Text, string[]][] = [];
            const walk = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
            for (let node = walk.nextNode() as Text; node !== null; node = walk.nextNode() as Text) {
                const words = node.data.match(/\S+\s*/g);
                node.data = '';
                if (words !== null) texts.push([node, words]);
            }
            document.body.appendChild(shell);
            this.shaping = { page, width: rect.pageWidth, shell, texts };
        }

        const job = this.shaping;
        while (job.texts.length > 0 && job.texts[0][1].length === 0) job.texts.shift()[0].data = '';
        if (job.texts.length === 0) {
            job.shell.remove();
            this.shaping = null;
            this.shaped.set(page, rect.pageWidth);
            return true;
        }

        const [node, words] = job.texts[0];
        node.data = words.splice(0, 12).join('');
        void job.shell.offsetHeight; // laid out (shaped) now, in this short task
        return false;
    }

    public update(): void {
        super.update();

        if (this.rightPage !== null) {
            this.rightPage.setOrientation(PageOrientation.RIGHT);
        }

        if (this.leftPage !== null) {
            this.leftPage.setOrientation(PageOrientation.LEFT);
        }
    }
}
