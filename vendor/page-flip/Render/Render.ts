// @ts-nocheck
import { PageFlip } from '../PageFlip';
import { Point, PageRect, RectPoints } from '../BasicTypes';
import { FlipDirection } from '../Flip/Flip';
import { Page, PageOrientation } from '../Page/Page';
import { FlipSetting, SizeType } from '../Settings';

type AnimationSuccessAction = () => void;

/**
 * Type describing calculated values for drop shadows
 */
type Shadow = {
    /** Shadow Position Start Point */
    pos: Point;
    /** The angle of the shadows relative to the book */
    angle: number;
    /** Base width shadow */
    width: number;
    /** Base shadow opacity */
    opacity: number;
    /** Flipping Direction, the direction of the shadow gradients */
    direction: FlipDirection;
    /** Flipping progress in percent (0 - 100) */
    progress: number;
    /** [modified] The pulled corner and its place on the flat page (page coordinates). The fold line is their
     * perpendicular bisector; the light and shadow layers are laid along it. */
    corner: Point;
    origin: Point;
};

/**
 * Type describing the animation process
 * Only one animation process can be started at a same time
 */
type AnimationProcess = {
    /** [modified] Draws the state at time t (0..1, linear in time). The path and its easing belong to the caller. */
    frame: (t: number) => void;
    /** Total animation duration */
    duration: number;
    /** Сallback at the end of the animation */
    onAnimateEnd: AnimationSuccessAction;
    /** Animation start time (Global Timer). [modified] Taken on the first frame: the loop may have been asleep */
    startedAt: number | null;
};

/**
 * Book orientation
 */
export enum Orientation {
    PORTRAIT = 'portrait',
    LANDSCAPE = 'landscape',
}

/**
 * Class responsible for rendering the book
 */
export abstract class Render {
    protected readonly setting: FlipSetting;
    protected readonly app: PageFlip;

    /** Left static book page */
    protected leftPage: Page = null;
    /** Right static book page */
    protected rightPage: Page = null;

    /** Page currently flipping */
    protected flippingPage: Page = null;
    /** Next page at the time of flipping */
    protected bottomPage: Page = null;

    /** Current flipping direction */
    protected direction: FlipDirection = null;
    /** Current book orientation */
    protected orientation: Orientation = null;
    /** Сurrent state of the shadows */
    protected shadow: Shadow = null;
    /** Сurrent animation process */
    protected animation: AnimationProcess = null;
    /** Page borders while flipping */
    protected pageRect: RectPoints = null;
    /** [modified] progress of the page turning now (0..1, by the corner position). The book moves to the middle and
     * its thickness opens with it when the cover turns. */
    protected flipProgress = 0;
    /** Current book area */
    private boundsRect: PageRect = null;
    /** [modified] the book's area is taller than wide (upright phone), measured with the book area */
    protected upright = false;

    private stopped = false;
    /** [modified] id of the requested animation frame, 0 = the loop is asleep */
    private frameId = 0;

    /**
     * Safari browser definitions for resolving a bug with a css property clip-area
     *
     * https://bugs.webkit.org/show_bug.cgi?id=126207
     */
    private safari = false;

    protected constructor(app: PageFlip, setting: FlipSetting) {
        this.setting = setting;
        this.app = app;

        // detect safari
        const regex = new RegExp('Version\\/[\\d\\.]+.*Safari/');
        this.safari = regex.exec(window.navigator.userAgent) !== null;
    }

    /**
     * Rendering action on each requestAnimationFrame call. The entire rendering process is performed only in this method
     */
    protected abstract drawFrame(): void;

    /**
     * Reload the render area, after update pages
     */
    public abstract reload(): void;

    /**
     * Executed when requestAnimationFrame is called. Performs the current animation process and call drawFrame()
     *
     * @param timer
     */
    private render(timer: number): void {
        if (this.animation !== null) {
            // [modified] The animation is a function of the elapsed time (any refresh rate gives the same duration)
            const animation = this.animation;
            if (animation.startedAt === null) animation.startedAt = timer;
            const elapsed = timer - animation.startedAt;

            // [modified] a frame within 1ms of the end is the last one (rAF times are rounded to 0.1ms: the 18th
            // 60Hz frame of a 300ms turn comes at 299.9ms and the end used to wait for the next frame)
            if (elapsed < animation.duration - 1) {
                animation.frame(Math.max(0, elapsed / animation.duration));
            } else {
                this.animation = null;
                animation.frame(1);
                animation.onAnimateEnd();
            }
        } else {
            // [modified] the page follows the finger / mouse a little on every frame
            this.app.getFlipController().update(timer);
        }

        this.drawFrame();
    }

    /**
     * Running requestAnimationFrame, and rendering process
     */
    public start(): void {
        this.update();
    }

    /**
     * [modified] Draw on the next animation frame. The loop only runs while something moves (an animation, or the
     * page following the finger / mouse) and sleeps otherwise; the original redrew every page 60 times a second.
     */
    public requestFrame(): void {
        if (this.stopped || this.frameId !== 0) return;
        this.frameId = requestAnimationFrame(this.loop);
    }

    private loop = (timer: number): void => {
        if (this.stopped) return;
        try {
            this.render(timer);
        } finally {
            this.frameId = 0; // requests made while drawing are already in this frame
        }
        if (this.animation !== null || this.app.getFlipController().isMoving()) this.requestFrame();
    };

    /** [modified] Stop the render loop (called from PageFlip.destroy) */
    public stop(): void {
        this.stopped = true;
        this.animation = null;
        if (this.frameId !== 0) cancelAnimationFrame(this.frameId);
        this.frameId = 0;
    }

    /**
     * Start a new animation process
     *
     * @param frame - [modified] draws the state at time t (0..1, linear in time)
     * @param {number} duration - total animation duration
     * @param {AnimationSuccessAction} onAnimateEnd - Animation callback function
     */
    public startAnimation(
        frame: (t: number) => void,
        duration: number,
        onAnimateEnd: AnimationSuccessAction
    ): void {
        this.finishAnimation(); // finish the previous animation process

        this.animation = {
            frame,
            duration,
            onAnimateEnd,
            startedAt: null,
        };
        this.requestFrame();
    }

    /**
     * End the current animation process and call the callback
     */
    public finishAnimation(): void {
        const animation = this.animation;
        this.animation = null;

        if (animation !== null) {
            animation.frame(1);

            if (animation.onAnimateEnd !== null) {
                animation.onAnimateEnd();
            }
        }
    }

    /**
     * Recalculate the size of the displayed area, and update the page orientation
     */
    public update(): void {
        this.boundsRect = null;
        const orientation = this.calculateBoundsRect();

        if (this.orientation !== orientation) {
            this.orientation = orientation;
            this.app.updateOrientation(orientation);
        }

        this.requestFrame(); // [modified] redraw in the new size
    }

    /**
     * Calculate the size and position of the book depending on the parent element and configuration parameters
     */
    private calculateBoundsRect(): Orientation {
        let orientation = Orientation.LANDSCAPE;

        const blockWidth = this.getBlockWidth();
        const middlePoint: Point = {
            x: blockWidth / 2,
            y: this.getBlockHeight() / 2,
        };

        const ratio = this.setting.width / this.setting.height;

        let pageWidth = this.setting.width;
        let pageHeight = this.setting.height;

        let left = middlePoint.x - pageWidth;

        if (this.setting.size === SizeType.STRETCH) {
            // [modified] singlePage forces the one-page (phone) layout regardless of the width
            if (
                this.setting.singlePage ||
                (blockWidth < this.setting.minWidth * 2 && this.app.getSettings().usePortrait)
            )
                orientation = Orientation.PORTRAIT;

            pageWidth =
                orientation === Orientation.PORTRAIT
                    ? this.getBlockWidth()
                    : this.getBlockWidth() / 2;

            if (pageWidth > this.setting.maxWidth) pageWidth = this.setting.maxWidth;

            pageHeight = pageWidth / ratio;
            if (pageHeight > this.getBlockHeight()) {
                pageHeight = this.getBlockHeight();
                pageWidth = pageHeight * ratio;
            }

            left =
                orientation === Orientation.PORTRAIT
                    ? middlePoint.x - pageWidth / 2 - pageWidth
                    : middlePoint.x - pageWidth;
        } else {
            if (blockWidth < pageWidth * 2) {
                if (this.app.getSettings().usePortrait) {
                    orientation = Orientation.PORTRAIT;
                    left = middlePoint.x - pageWidth / 2 - pageWidth;
                }
            }
        }

        this.upright = this.getBlockHeight() > blockWidth;
        this.boundsRect = {
            left,
            top: middlePoint.y - pageHeight / 2,
            width: pageWidth * 2,
            height: pageHeight,
            pageWidth: pageWidth,
        };

        return orientation;
    }

    /**
     * Set the current parameters of the drop shadow
     *
     * @param {Point} pos - Shadow Position Start Point
     * @param {number} angle - The angle of the shadows relative to the book
     * @param {number} progress - Flipping progress in percent (0 - 100)
     * @param {FlipDirection} direction - Flipping Direction, the direction of the shadow gradients
     * @param {Point} corner - [modified] the pulled corner (page coordinates)
     * @param {Point} origin - [modified] the place of that corner on the flat page (page coordinates)
     */
    public setShadowData(
        pos: Point,
        angle: number,
        progress: number,
        direction: FlipDirection,
        corner: Point,
        origin: Point
    ): void {
        this.flipProgress = progress / 100; // [modified] used even without shadows
        this.requestFrame(); // [modified]
        if (!this.app.getSettings().drawShadow) return;

        const maxShadowOpacity = 100 * this.getSettings().maxShadowOpacity;

        this.shadow = {
            pos,
            angle,
            width: (((this.getRect().pageWidth * 3) / 4) * progress) / 100,
            opacity: ((100 - progress) * maxShadowOpacity) / 100 / 100,
            direction,
            progress: progress * 2,
            corner,
            origin,
        };
    }

    /**
     * Clear shadow
     */
    public clearShadow(): void {
        this.shadow = null;
        this.requestFrame(); // [modified]
    }

    /**
     * Get parent block offset width
     */
    public getBlockWidth(): number {
        return this.app.getUI().getDistElement().offsetWidth;
    }

    /**
     * Get parent block offset height
     */
    public getBlockHeight(): number {
        return this.app.getUI().getDistElement().offsetHeight;
    }

    /**
     * Get current flipping direction
     */
    public getDirection(): FlipDirection {
        return this.direction;
    }

    /**
     * Сurrent size and position of the book
     */
    public getRect(): PageRect {
        if (this.boundsRect === null) this.calculateBoundsRect();

        return this.boundsRect;
    }

    /**
     * Get configuration object
     */
    public getSettings(): FlipSetting {
        return this.app.getSettings();
    }

    /**
     * Get current book orientation
     */
    public getOrientation(): Orientation {
        return this.orientation;
    }

    /**
     * Set page area while flipping
     *
     * @param direction
     */
    public setPageRect(pageRect: RectPoints): void {
        this.pageRect = pageRect;
    }

    /**
     * Set flipping direction
     *
     * @param direction
     */
    public setDirection(direction: FlipDirection): void {
        this.direction = direction;
    }

    /**
     * Set right static book page
     *
     * @param page
     */
    public setRightPage(page: Page): void {
        if (page !== null) page.setOrientation(PageOrientation.RIGHT);

        this.rightPage = page;
        this.requestFrame(); // [modified]
    }

    /**
     * Set left static book page
     * @param page
     */
    public setLeftPage(page: Page): void {
        if (page !== null) page.setOrientation(PageOrientation.LEFT);

        this.leftPage = page;
        this.requestFrame(); // [modified]
    }

    /**
     * Set next page at the time of flipping
     * @param page
     */
    public setBottomPage(page: Page): void {
        if (page !== null)
            page.setOrientation(
                this.direction === FlipDirection.BACK ? PageOrientation.LEFT : PageOrientation.RIGHT
            );

        this.bottomPage = page;
        this.requestFrame(); // [modified]
    }

    /**
     * Set currently flipping page
     *
     * @param page
     */
    public setFlippingPage(page: Page): void {
        if (page !== null)
            page.setOrientation(
                this.direction === FlipDirection.FORWARD &&
                    this.orientation !== Orientation.PORTRAIT
                    ? PageOrientation.LEFT
                    : PageOrientation.RIGHT
            );

        this.flippingPage = page;
        this.requestFrame(); // [modified]
    }

    /**
     * Coordinate conversion function. Window coordinates -> to book coordinates
     *
     * @param {Point} pos - Global coordinates relative to the window
     * @returns {Point} Coordinates relative to the book
     */
    public convertToBook(pos: Point): Point {
        const rect = this.getRect();

        return {
            x: pos.x - rect.left,
            y: pos.y - rect.top,
        };
    }

    public isSafari(): boolean {
        return this.safari;
    }

    /**
     * Coordinate conversion function. Window coordinates -> to current coordinates of the working page
     *
     * @param {Point} pos - Global coordinates relative to the window
     * @param {FlipDirection} direction  - Current flipping direction
     *
     * @returns {Point} Coordinates relative to the work page
     */
    public convertToPage(pos: Point, direction?: FlipDirection): Point {
        if (!direction) direction = this.direction;

        const rect = this.getRect();
        const x =
            direction === FlipDirection.FORWARD
                ? pos.x - rect.left - rect.width / 2
                : rect.width / 2 - pos.x + rect.left;

        return {
            x,
            y: pos.y - rect.top,
        };
    }

    /**
     * Coordinate conversion function. Coordinates relative to the work page -> Window coordinates
     *
     * @param {Point} pos - Coordinates relative to the work page
     * @param {FlipDirection} direction  - Current flipping direction
     *
     * @returns {Point} Global coordinates relative to the window
     */
    public convertToGlobal(pos: Point, direction?: FlipDirection): Point {
        if (!direction) direction = this.direction;

        if (pos == null) return null;

        const rect = this.getRect();

        const x =
            direction === FlipDirection.FORWARD
                ? pos.x + rect.left + rect.width / 2
                : rect.width / 2 - pos.x + rect.left;

        return {
            x,
            y: pos.y + rect.top,
        };
    }

    /**
     * Casting the coordinates of the corners of the rectangle in the coordinates relative to the window
     *
     * @param {RectPoints} rect - Coordinates of the corners of the rectangle relative to the work page
     * @param {FlipDirection} direction  - Current flipping direction
     *
     * @returns {RectPoints} Coordinates of the corners of the rectangle relative to the window
     */
    public convertRectToGlobal(rect: RectPoints, direction?: FlipDirection): RectPoints {
        if (!direction) direction = this.direction;

        return {
            topLeft: this.convertToGlobal(rect.topLeft, direction),
            topRight: this.convertToGlobal(rect.topRight, direction),
            bottomLeft: this.convertToGlobal(rect.bottomLeft, direction),
            bottomRight: this.convertToGlobal(rect.bottomRight, direction),
        };
    }
}
