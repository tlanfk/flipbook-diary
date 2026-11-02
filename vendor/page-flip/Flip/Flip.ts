// @ts-nocheck
import { Orientation, Render } from '../Render/Render';
import { PageFlip } from '../PageFlip';
import { PageRect, Point } from '../BasicTypes';
import { FlipCalculation } from './FlipCalculation';
import { Page, PageDensity } from '../Page/Page';

/**
 * Flipping direction
 */
export enum FlipDirection {
    FORWARD,
    BACK,
}

/**
 * Active corner when flipping
 */
export enum FlipCorner {
    TOP = 'top',
    BOTTOM = 'bottom',
}

/**
 * State of the book
 */
export enum FlippingState {
    /** The user folding the page */
    USER_FOLD = 'user_fold',

    /** Mouse over active corners */
    FOLD_CORNER = 'fold_corner',

    /** During flipping animation */
    FLIPPING = 'flipping',

    /** Base state */
    READ = 'read',
}

/**
 * Class representing the flipping process
 */
export class Flip {
    private readonly render: Render;
    private readonly app: PageFlip;

    private flippingPage: Page = null;
    private bottomPage: Page = null;

    private calc: FlipCalculation = null;

    private state: FlippingState = FlippingState.READ;

    /**
     * [modified] Where the pulled corner is heading (page coordinates). Like FlipHTML5 the corner does not jump to
     * the finger / mouse: on every frame it moves 22% of the remaining way per 16.7ms (time based:
     * 1 − 0.78^(dt/16.7), τ ≈ 66.9ms) and snaps within 1px.
     */
    private target: Point = null;
    /** the corner drawn last, after the paper limit: the next step starts from here */
    private current: Point = null;
    /** called once the corner reached the target (lying down again) */
    private onTarget: (() => void) | null = null;
    /** the corner stopped moving (reached the target, or held by the paper limit) */
    private settled = true;
    private lastFrame: number | null = null;
    /** [modified] grabbed along the outer edge: the edge point at the finger's height (page coordinates), null = by the corner */
    private grab: Point = null;
    /** [modified] the corner area the page was grabbed in (or hovered), null = none */
    private grabZone: string | null = null;
    /**
     * [modified] One-page layout going back (FlipHTML5): the previous page folds open in place, drawn as its forward
     * turn played backwards. The geometry is FORWARD; the corner rests at −W (turned) and the turn ends at +W (flat).
     */
    private reverse = false;

    constructor(render: Render, app: PageFlip) {
        this.render = render;
        this.app = app;
    }

    /**
     * [modified] The user starts pulling the page.
     *
     * @param grabPos - where the page is grabbed (relative window)
     * @param direction - turn direction, null = by the grabbed position
     * @param byCorner - grabbed in a corner area: the corner follows the finger. Otherwise the page is held at its
     * outer edge at the finger's height, and that point follows the finger.
     * @param pressPos - [modified] where the press began (relative window): held along the edge, a finger going up
     * folds the bottom corner and one going down the top corner
     *
     * @returns false if there is no page to turn that way
     */
    public startFold(
        grabPos: Point,
        direction: FlipDirection | null,
        byCorner: boolean,
        pressPos: Point | null = null
    ): boolean {
        const zone = byCorner ? this.cornerZone(grabPos) : null;

        // a corner already lifted by the mouse is taken over as it is
        const takeOver =
            zone !== null && this.state === FlippingState.FOLD_CORNER && zone === this.grabZone;

        if (!takeOver) {
            this.stopAll();
            const rising = pressPos === null ? 0 : Math.sign(pressPos.y - grabPos.y);
            const corner = rising > 0 ? FlipCorner.BOTTOM : rising < 0 ? FlipCorner.TOP : null;
            if (!this.start(grabPos, direction, corner)) return false;
            this.current = this.getRestPoint();
        }

        // [modified] held 5px inside the edge; one page going back FlipHTML5 holds the very edge (it stays under the
        // finger: x=150 → fold at (150 + right edge) / 2)
        this.grabZone = zone;
        this.grab = byCorner
            ? null
            : {
                  x: this.getBoundsRect().pageWidth - (this.reverse ? 0 : 5),
                  y: this.render.convertToPage(grabPos).y,
              };

        this.setState(FlippingState.USER_FOLD);
        return true;
    }

    /**
     * Called when the page folding (User drags page corner)
     *
     * @param globalPos - Touch Point Coordinates (relative window)
     */
    public fold(globalPos: Point): void {
        if (this.calc === null || this.state !== FlippingState.USER_FOLD) return;

        const pos = this.render.convertToPage(globalPos);
        if (this.grab === null) {
            this.followTo(pos);
            return;
        }

        // [modified] the corner that folds is one on the held side of the fold line: pulling the edge up and away
        // folds the bottom corner (taking the top one gave a sliver at the top corner, away from the finger)
        const corner = this.getCornerPoint();
        if (!this.isFolded(corner, this.grab, pos)) {
            const other = { x: corner.x, y: this.getBoundsRect().height - corner.y };
            if (this.isFolded(other, this.grab, pos)) this.switchCorner();
        }
        this.followTo(this.mirrorCorner(this.grab, pos));
    }

    /** [modified] true if the point lies on the held side of the fold line between the held point and the finger */
    private isFolded(point: Point, held: Point, finger: Point): boolean {
        const nx = finger.x - held.x;
        const ny = finger.y - held.y;

        return (point.x - (held.x + finger.x) / 2) * nx + (point.y - (held.y + finger.y) / 2) * ny < 0;
    }

    /**
     * [modified] Pull the other corner (top ↔ bottom) with the same fold line: it starts from the mirror image of
     * its own place over the fold drawn now, so the picture does not jump. The paper limit is the same for both
     * corners (both ends of the spine stay on the flat side).
     */
    private switchCorner(): void {
        const rect = this.getBoundsRect();
        const from = this.getCornerPoint();
        const at = this.current;

        this.calc = new FlipCalculation(
            this.calc.getDirection(),
            this.calc.getCorner() === FlipCorner.BOTTOM ? FlipCorner.TOP : FlipCorner.BOTTOM,
            rect.pageWidth.toString(10),
            rect.height.toString(10)
        );
        this.current = this.mirrorCorner(from, at);
    }

    /**
     * Page turning with animation
     *
     * @param globalPos - Touch Point Coordinates (relative window)
     */
    public flip(globalPos: Point): void {
        if (this.app.getSettings().disableFlipByClick && !this.isPointOnCorners(globalPos)) return;

        // [modified] the corner is already lifted by the mouse: turn on from there
        if (this.state === FlippingState.FOLD_CORNER && this.calc !== null && this.calc.getPosition()) {
            this.finishTurn();
            return;
        }

        this.autoFlip(globalPos);
    }

    /**
     * [modified] Page turning by itself (keys, buttons, a click), as measured on FlipHTML5: the corner starts just
     * inside the outer corner (W − 2) and goes to the far side (−W) with easeInOutSine, rising along an arc that is
     * 5% of the page width high over the spine: y = H − 0.05·√(W² − x²). Time based (flippingTime, 300ms), so it
     * takes the same time on any refresh rate (FlipHTML5 counts 18 frames).
     * Going back in the one-page layout the corner takes the mirrored way, from −(W − 2) to W.
     *
     * @param globalPos - a point of the page to turn, its height picks the corner (relative window)
     */
    private autoFlip(globalPos: Point): void {
        // the flipiing process is already running
        this.stopAll();

        if (!this.start(globalPos)) return;

        const rect = this.getBoundsRect();
        const width = rect.pageWidth;
        const height = rect.height;
        const bottom = this.calc.getCorner() === FlipCorner.BOTTOM;
        const way = this.reverse ? -1 : 1;

        this.setState(FlippingState.FLIPPING);

        const end = { x: -way * width, y: bottom ? height : 0 };

        this.render.startAnimation(
            (t) => {
                const ease = -(Math.cos(Math.PI * t) - 1) / 2;
                const x = way * (width - 2 - (2 * width - 2) * ease);
                const lift = 0.05 * Math.sqrt(Math.max(0, width * width - x * x));

                this.drawTurn({ x, y: bottom ? height - lift : lift }, end);
            },
            this.app.getSettings().flippingTime,
            () => this.finish(true)
        );
    }

    /**
     * [modified] One frame of a turn. Going back in the one-page layout the turn ends with the corner on its own
     * place: within ~2px of it the fold line leaves the page and the position cannot be drawn (the frame before
     * stayed on screen, up to 22px short at 30Hz). That close, the turn is over.
     */
    private drawTurn(pos: Point, end: Point): void {
        if (!this.do(pos) && Math.hypot(pos.x - end.x, pos.y - end.y) < 2) this.render.finishAnimation();
    }

    /**
     * Start the flipping process. Find direction and corner of flipping. Creating an object for calculation.
     *
     * @param {Point} globalPos - Touch Point Coordinates (relative window)
     * @param forcedCorner - [modified] the corner to pull, null = by the height of globalPos
     *
     * @returns {boolean} True if flipping is possible, false otherwise
     */
    public start(
        globalPos: Point,
        forcedDirection: FlipDirection | null = null,
        forcedCorner: FlipCorner | null = null
    ): boolean {
        this.reset();

        const bookPos = this.render.convertToBook(globalPos);
        const rect = this.getBoundsRect();

        // Find the direction of flipping ([modified] a swipe direction chosen by the caller wins)
        const direction = forcedDirection ?? this.getDirectionByPoint(bookPos);

        // Find the active corner
        const flipCorner = forcedCorner ?? (bookPos.y >= rect.height / 2 ? FlipCorner.BOTTOM : FlipCorner.TOP);

        if (!this.checkDirection(direction)) return false;

        try {
            this.flippingPage = this.app.getPageCollection().getFlippingPage(direction);
            this.bottomPage = this.app.getPageCollection().getBottomPage(direction);

            // In landscape mode, needed to set the density  of the next page to the same as that of the flipped
            if (this.render.getOrientation() === Orientation.LANDSCAPE) {
                if (direction === FlipDirection.BACK) {
                    const nextPage = this.app.getPageCollection().nextBy(this.flippingPage);

                    if (nextPage !== null) {
                        if (this.flippingPage.getDensity() !== nextPage.getDensity()) {
                            this.flippingPage.setDrawingDensity(PageDensity.HARD);
                            nextPage.setDrawingDensity(PageDensity.HARD);
                        }
                    }
                } else {
                    const prevPage = this.app.getPageCollection().prevBy(this.flippingPage);

                    if (prevPage !== null) {
                        if (this.flippingPage.getDensity() !== prevPage.getDensity()) {
                            this.flippingPage.setDrawingDensity(PageDensity.HARD);
                            prevPage.setDrawingDensity(PageDensity.HARD);
                        }
                    }
                }
            }

            // [modified] one page going back: the forward turn of the previous page, played backwards. That page
            // lies under the fold (static), the current one stays beside it (bottom page)
            this.reverse =
                this.render.getOrientation() === Orientation.PORTRAIT && direction === FlipDirection.BACK;
            const drawDirection = this.reverse ? FlipDirection.FORWARD : direction;
            if (this.reverse) {
                const pages = this.app.getPageCollection();
                this.render.setRightPage(pages.getPage(pages.getCurrentSpreadIndex() - 1));
            }

            this.render.setDirection(drawDirection);
            this.calc = new FlipCalculation(
                drawDirection,
                flipCorner,
                rect.pageWidth.toString(10), // fix bug with type casting
                rect.height.toString(10) // fix bug with type casting
            );

            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Perform calculations for the current page position. Pass data to render object
     *
     * @param {Point} pagePos - Touch Point Coordinates (relative active page)
     *
     * @returns [modified] false if this position could not be drawn
     */
    private do(pagePos: Point): boolean {
        if (this.calc === null) return false; // Flipping process not started

        if (this.calc.calc(pagePos)) {
            // Perform calculations for a specific position
            const progress = this.calc.getFlippingProgress();

            this.bottomPage.setArea(this.calc.getBottomClipArea());
            this.bottomPage.setPosition(this.calc.getBottomPagePosition());
            this.bottomPage.setAngle(0);
            this.bottomPage.setHardAngle(0);

            this.flippingPage.setArea(this.calc.getFlippingClipArea());
            this.flippingPage.setPosition(this.calc.getActiveCorner());
            this.flippingPage.setAngle(this.calc.getAngle());

            if (this.calc.getDirection() === FlipDirection.FORWARD) {
                this.flippingPage.setHardAngle((90 * (200 - progress * 2)) / 100);
            } else {
                this.flippingPage.setHardAngle((-90 * (200 - progress * 2)) / 100);
            }

            this.render.setPageRect(this.calc.getRect());

            this.render.setBottomPage(this.bottomPage);
            this.render.setFlippingPage(this.flippingPage);

            this.render.setShadowData(
                this.calc.getShadowStartPoint(),
                this.calc.getShadowAngle(),
                progress,
                this.calc.getDirection(),
                this.calc.getPosition(),
                this.calc.getCornerOrigin()
            );

            return true;
        }

        return false;
    }

    /**
     * Turn to the specified page number (with animation)
     *
     * @param {number} page - New page number
     * @param {FlipCorner} corner - Active page corner when turning
     */
    public flipToPage(page: number, corner: FlipCorner): void {
        const current = this.app.getPageCollection().getCurrentSpreadIndex();
        const next = this.app.getPageCollection().getSpreadIndexByPage(page);

        try {
            if (next > current) {
                this.app.getPageCollection().setCurrentSpreadIndex(next - 1);
                this.flipNext(corner);
            }
            if (next < current) {
                this.app.getPageCollection().setCurrentSpreadIndex(next + 1);
                this.flipPrev(corner);
            }
        } catch (e) {
            //
        }
    }

    /**
     * Turn to the next page (with animation)
     *
     * @param {FlipCorner} corner - Active page corner when turning
     */
    public flipNext(corner: FlipCorner): void {
        // [modified] y must include rect.top: when the book is letterboxed (top > 0) the original y=1 fell
        // outside the book and the corner check made flipNext() a silent no-op.
        // [modified] not a click: the corner-area check of flip() does not apply
        const rect = this.render.getRect();
        this.autoFlip({
            x: rect.left + rect.pageWidth * 2 - 10,
            y: corner === FlipCorner.TOP ? rect.top + 1 : rect.top + rect.height - 2,
        });
    }

    /**
     * Turn to the prev page (with animation)
     *
     * @param {FlipCorner} corner - Active page corner when turning
     */
    public flipPrev(corner: FlipCorner): void {
        const rect = this.render.getRect();
        this.autoFlip({
            x: rect.left + 10,
            y: corner === FlipCorner.TOP ? rect.top + 1 : rect.top + rect.height - 2,
        });
    }

    /**
     * Called when the user has stopped flipping
     *
     * [modified] Release rule measured on FlipHTML5 (no speed rule): the page turns if the finger is past the base
     * line (two pages: the spine, one page: the middle of the page) or its last horizontal movement (2px or more,
     * kept through a pause) went the turning way; otherwise it lies down again.
     *
     * @param globalPos - where the finger was released (relative window)
     * @param lastDir - direction of the last horizontal finger movement (−1 left, 1 right, 0 none)
     * @param isTouch - released by a touch (not a mouse)
     *
     * @returns true if the page turns
     */
    public stopMove(globalPos: Point, lastDir = 0, isTouch = true): boolean {
        if (this.calc === null || this.state !== FlippingState.USER_FOLD) return false;

        // [modified] no valid fold was ever drawn for this drag: just go back to the normal state
        if (!this.calc.getPosition()) {
            this.finish(false);
            return false;
        }

        // released in the corner area it was grabbed in: nothing happens. A mouse keeps lifting the corner
        // (hover), on a touch screen the page lies down again.
        if (this.grabZone !== null && this.cornerZone(globalPos) === this.grabZone) {
            if (!isTouch && this.app.getSettings().showPageCorners) {
                this.setState(FlippingState.FOLD_CORNER);
                this.followTo(this.render.convertToPage(globalPos));
            } else {
                this.returnBack();
            }
            return false;
        }

        const rect = this.getBoundsRect();
        const forward = this.getTurnDirection() === FlipDirection.FORWARD;
        const base =
            this.render.getOrientation() === Orientation.PORTRAIT ? rect.pageWidth * 1.5 : rect.pageWidth;
        const x = this.render.convertToBook(globalPos).x;

        const crossed = forward ? x < base : x > base;
        const towardTurn = forward ? lastDir < 0 : lastDir > 0;

        if (crossed || towardTurn) {
            this.finishTurn();
            return true;
        }

        this.returnBack();
        return false;
    }

    /**
     * Fold the corners of the book when the mouse pointer is over them.
     * Called when the mouse pointer is over the book without clicking
     *
     * [modified] No fixed 50px fold: the corner follows the mouse from its own place (FlipHTML5), and lies down the
     * same way when the mouse leaves the corner area.
     *
     * @param globalPos
     */
    public showCorner(globalPos: Point): void {
        if (!this.checkState(FlippingState.READ, FlippingState.FOLD_CORNER)) return;

        let zone = this.cornerZone(globalPos);

        // [modified] one page: the back corners stay still (going back unfolds the whole previous page, too much for
        // a hint)
        if (
            zone !== null &&
            zone[0] === 'l' &&
            this.render.getOrientation() === Orientation.PORTRAIT
        )
            zone = null;

        if (zone !== null) {
            // another corner: the previous one lies down at once
            if (this.calc !== null && zone !== this.grabZone) this.finish(false);

            if (this.calc === null) {
                if (!this.start(globalPos)) return;

                this.setState(FlippingState.FOLD_CORNER);
                this.grabZone = zone;
                this.current = this.getRestPoint();
            }

            this.followTo(this.render.convertToPage(globalPos));
        } else if (this.calc !== null) {
            this.followTo(this.getRestPoint(), () => this.finish(false));
        }
    }

    /**
     * [modified] Called on every animation frame without an animation: the corner moves part of the way to its
     * target, the paper limit applies, and the limited point is where the next step starts (FlipHTML5).
     *
     * @param now - frame time (ms)
     */
    public update(now: number): void {
        if (this.calc === null || this.target === null || this.settled) return;

        const dt = this.lastFrame === null ? 16.7 : now - this.lastFrame;
        this.lastFrame = now;

        const to = this.target;
        const move = (p: Point, k: number) => ({ x: p.x + (to.x - p.x) * k, y: p.y + (to.y - p.y) * k });
        const near = (p: Point) => Math.hypot(to.x - p.x, to.y - p.y) < 1;

        // FlipHTML5 takes 22% of the way per (60Hz) frame and limits that point. Whole 16.7ms steps are taken the
        // same way and the rest of the time as its share of one more step: free, the corner moves
        // 1 − 0.78^(dt/16.7) of the way; at the paper limit it rests where FlipHTML5 rests at any refresh rate
        // (a time-based step of its own size moved that resting place by up to 2px at 240Hz).
        let next = this.current;
        let reached = false;
        let left = Math.max(0, dt);
        for (; !reached && left >= 16.7; left -= 16.7) {
            const free = move(next, 0.22);
            reached = near(free);
            next = this.calc.limit(reached ? to : free);
        }
        if (!reached && left > 0) {
            const k = 1 - Math.pow(0.78, left / 16.7);
            reached = near(move(next, k));
            if (reached) next = this.calc.limit(to);
            else {
                const step = this.calc.limit(move(next, 0.22));
                const share = k / 0.22;
                next = { x: next.x + (step.x - next.x) * share, y: next.y + (step.y - next.y) * share };
            }
        }

        const pos = this.do(next) ? this.calc.getPosition() : next;
        this.current = { x: pos.x, y: pos.y };

        // still moving if one more whole step would move it (measured per step, so the same at any refresh rate)
        const step = this.calc.limit(move(pos, 0.22));
        this.settled = reached || Math.hypot(step.x - pos.x, step.y - pos.y) < 0.01;
        if (this.settled) this.lastFrame = null;

        if (reached && this.onTarget !== null) {
            const done = this.onTarget;
            this.onTarget = null;
            done();
        }
    }

    /**
     * [modified] true while the corner still moves toward its target (the render loop must keep running)
     */
    public isMoving(): boolean {
        return this.target !== null && !this.settled;
    }

    /** [modified] Let the corner head for a new target */
    private followTo(target: Point, onTarget: (() => void) | null = null): void {
        this.target = target;
        this.onTarget = onTarget;
        this.settled = false;
        this.render.requestFrame();
    }

    /**
     * [modified] Finish the turn from where the corner is now: x and y with easeOutSine, the time in proportion to
     * the remaining way (flippingTime for the whole 2W)
     */
    private finishTurn(): void {
        const rect = this.getBoundsRect();
        const from = this.calc.getPosition();
        const to = {
            x: this.reverse ? rect.pageWidth : -rect.pageWidth,
            y: this.calc.getCorner() === FlipCorner.BOTTOM ? rect.height : 0,
        };
        const duration =
            (this.app.getSettings().flippingTime * Math.abs(from.x - to.x)) / (2 * rect.pageWidth);

        this.target = null;
        this.onTarget = null;
        this.setState(FlippingState.FLIPPING);

        this.render.startAnimation(
            (t) => {
                const ease = Math.sin((Math.PI * t) / 2);
                this.drawTurn({ x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease }, to);
            },
            Math.max(1, duration),
            () => this.finish(true)
        );
    }

    /** [modified] The page lies down again: the corner goes back with the same following (stops within 1px) */
    private returnBack(): void {
        this.setState(FlippingState.FLIPPING);
        this.followTo(this.getRestPoint(), () => this.finish(false));
    }

    /** [modified] End of the flipping process: turn the page (or not) and go back to the normal state */
    private finish(isTurned: boolean): void {
        if (this.calc === null) return;

        if (isTurned) {
            if (this.getTurnDirection() === FlipDirection.BACK) this.app.turnToPrevPage();
            else this.app.turnToNextPage();
        } else if (this.reverse) {
            // the previous page lay under the fold: the current one is shown again
            const pages = this.app.getPageCollection();
            this.render.setRightPage(pages.getPage(pages.getCurrentSpreadIndex()));
        }

        this.render.setBottomPage(null);
        this.render.setFlippingPage(null);
        this.render.clearShadow();

        this.setState(FlippingState.READ);
        this.reset();
    }

    /** [modified] End whatever runs now (an animation turns its page at once, a fold lies down at once) */
    private stopAll(): void {
        this.render.finishAnimation();
        if (this.calc !== null) this.finish(false);
    }

    /** [modified] The pulled corner at its own place (page coordinates) */
    private getCornerPoint(): Point {
        const rect = this.getBoundsRect();

        return { x: rect.pageWidth, y: this.calc.getCorner() === FlipCorner.BOTTOM ? rect.height : 0 };
    }

    /** [modified] Where the corner rests while the page is not turned: its own place, or turned over (reverse) */
    private getRestPoint(): Point {
        const corner = this.getCornerPoint();

        return this.reverse ? { x: -corner.x, y: corner.y } : corner;
    }

    /** [modified] The way the page turns (a reverse fold is drawn FORWARD but goes back) */
    private getTurnDirection(): FlipDirection {
        return this.reverse ? FlipDirection.BACK : this.calc.getDirection();
    }

    /**
     * [modified] Held along the outer edge: the fold is the perpendicular bisector between the held point and the
     * finger, so the corner is the mirror image of its own place over that line.
     */
    private mirrorCorner(held: Point, finger: Point): Point {
        const corner = this.getCornerPoint();
        const nx = finger.x - held.x;
        const ny = finger.y - held.y;
        const len2 = nx * nx + ny * ny;
        if (len2 < 1e-6) return corner;

        const mx = (held.x + finger.x) / 2;
        const my = (held.y + finger.y) / 2;
        const d = ((corner.x - mx) * nx + (corner.y - my) * ny) / len2;

        return { x: corner.x - 2 * d * nx, y: corner.y - 2 * d * ny };
    }

    /**
     * Get the current calculations object
     */
    public getCalculation(): FlipCalculation {
        return this.calc;
    }

    /**
     * Get current flipping state
     */
    public getState(): FlippingState {
        return this.state;
    }

    private setState(newState: FlippingState): void {
        if (this.state !== newState) {
            this.app.updateState(newState);
            this.state = newState;
        }
    }

    private getDirectionByPoint(touchPos: Point): FlipDirection {
        const rect = this.getBoundsRect();

        if (this.render.getOrientation() === Orientation.PORTRAIT) {
            if (touchPos.x - rect.pageWidth <= rect.width / 5) {
                return FlipDirection.BACK;
            }
        } else if (touchPos.x < rect.width / 2) {
            return FlipDirection.BACK;
        }

        return FlipDirection.FORWARD;
    }

    private checkDirection(direction: FlipDirection): boolean {
        if (direction === FlipDirection.FORWARD)
            return this.app.getCurrentPageIndex() < this.app.getPageCount() - 1;

        return this.app.getCurrentPageIndex() >= 1;
    }

    private reset(): void {
        this.calc = null;
        this.flippingPage = null;
        this.bottomPage = null;

        this.target = null;
        this.current = null;
        this.onTarget = null;
        this.settled = true;
        this.lastFrame = null;
        this.grab = null;
        this.grabZone = null;
        this.reverse = false;
    }

    private getBoundsRect(): PageRect {
        return this.render.getRect();
    }

    private checkState(...states: FlippingState[]): boolean {
        for (const state of states) {
            if (this.state === state) return true;
        }

        return false;
    }

    public isPointOnCorners(globalPos: Point): boolean {
        return this.cornerZone(globalPos) !== null;
    }

    /**
     * [modified] The corner area the point is in ('lt', 'rb' ...), null = none. As on FlipHTML5 each corner of the
     * shown page(s) has a quarter ellipse with radii 0.2 × page width and 0.2 × page height (was a square with
     * the side diagonal / 5, over the hidden left half too in the one-page layout).
     */
    private cornerZone(globalPos: Point): string | null {
        const rect = this.getBoundsRect();
        const bookPos = this.render.convertToBook(globalPos);

        const left = this.render.getOrientation() === Orientation.PORTRAIT ? rect.pageWidth : 0;
        const right = rect.width;

        if (bookPos.x <= left || bookPos.x >= right || bookPos.y <= 0 || bookPos.y >= rect.height)
            return null;

        const nearLeft = bookPos.x - left < right - bookPos.x;
        const nearTop = bookPos.y < rect.height / 2;
        const dx = (nearLeft ? bookPos.x - left : right - bookPos.x) / (rect.pageWidth * 0.2);
        const dy = (nearTop ? bookPos.y : rect.height - bookPos.y) / (rect.height * 0.2);

        if (dx * dx + dy * dy > 1) return null;

        return (nearLeft ? 'l' : 'r') + (nearTop ? 't' : 'b');
    }
}
