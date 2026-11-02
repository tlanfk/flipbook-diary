// @ts-nocheck
import { PageFlip } from '../PageFlip';
import { Point } from '../BasicTypes';
import { FlipSetting, SizeType } from '../Settings';
import { Orientation } from '../Render/Render';

/**
 * UI Class, represents work with DOM
 */
export abstract class UI {
    protected readonly parentElement: HTMLElement;

    protected readonly app: PageFlip;
    protected readonly wrapper: HTMLElement;
    protected distElement: HTMLElement;

    /** [modified] id of the finger being tracked (other fingers are ignored), null = none */
    private touchId: number | null = null;
    private lastTouchPos: Point | null = null;
    private mouseDown = false;

    private onResize = (): void => {
        this.update();
    };

    /**
     * @constructor
     *
     * @param {HTMLElement} inBlock - Root HTML Element
     * @param {PageFlip} app - PageFlip instanse
     * @param {FlipSetting} setting - Configuration object
     */
    protected constructor(inBlock: HTMLElement, app: PageFlip, setting: FlipSetting) {
        this.parentElement = inBlock;

        inBlock.classList.add('stf__parent');
        // Add first wrapper
        inBlock.insertAdjacentHTML('afterbegin', '<div class="stf__wrapper"></div>');

        this.wrapper = inBlock.querySelector('.stf__wrapper');

        this.app = app;

        const k = this.app.getSettings().usePortrait ? 1 : 2;

        // Setting block sizes based on configuration
        inBlock.style.minWidth = setting.minWidth * k + 'px';
        inBlock.style.minHeight = setting.minHeight + 'px';

        if (setting.size === SizeType.FIXED) {
            inBlock.style.minWidth = setting.width * k + 'px';
            inBlock.style.minHeight = setting.height + 'px';
        }

        if (setting.autoSize) {
            inBlock.style.width = '100%';
            inBlock.style.maxWidth = setting.maxWidth * 2 + 'px';
        }

        inBlock.style.display = 'block';

        window.addEventListener('resize', this.onResize, false);
    }

    /**
     * Destructor. Remove all HTML elements and all event handlers
     */
    public destroy(): void {
        if (this.app.getSettings().useMouseEvents) this.removeHandlers();

        this.distElement.remove();
        this.wrapper.remove();
    }

    /**
     * Updating child components when resizing
     */
    public abstract update(): void;

    /**
     * Get parent element for book
     *
     * @returns {HTMLElement}
     */
    public getDistElement(): HTMLElement {
        return this.distElement;
    }

    /**
     * Get wrapper element
     *
     * @returns {HTMLElement}
     */
    public getWrapper(): HTMLElement {
        return this.wrapper;
    }

    /**
     * Updates styles and sizes based on book orientation
     *
     * @param {Orientation} orientation - New book orientation
     */
    public setOrientationStyle(orientation: Orientation): void {
        this.wrapper.classList.remove('--portrait', '--landscape');

        if (orientation === Orientation.PORTRAIT) {
            if (this.app.getSettings().autoSize)
                this.wrapper.style.paddingBottom =
                    (this.app.getSettings().height / this.app.getSettings().width) * 100 + '%';

            this.wrapper.classList.add('--portrait');
        } else {
            if (this.app.getSettings().autoSize)
                this.wrapper.style.paddingBottom =
                    (this.app.getSettings().height / (this.app.getSettings().width * 2)) * 100 +
                    '%';

            this.wrapper.classList.add('--landscape');
        }

        this.update();
    }

    protected removeHandlers(): void {
        window.removeEventListener('resize', this.onResize);

        this.distElement.removeEventListener('mousedown', this.onMouseDown);
        this.distElement.removeEventListener('touchstart', this.onTouchStart);
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('touchmove', this.onTouchMove);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('touchend', this.onTouchEnd);
        window.removeEventListener('touchcancel', this.onTouchCancel);
    }

    protected setHandlers(): void {
        window.addEventListener('resize', this.onResize, false);
        if (!this.app.getSettings().useMouseEvents) return;

        this.distElement.addEventListener('mousedown', this.onMouseDown);
        this.distElement.addEventListener('touchstart', this.onTouchStart);
        window.addEventListener('mousemove', this.onMouseMove);
        // [modified] must be non-passive: onTouchMove calls preventDefault to stop the page from scrolling
        window.addEventListener('touchmove', this.onTouchMove, { passive: false });
        window.addEventListener('mouseup', this.onMouseUp);
        window.addEventListener('touchend', this.onTouchEnd);
        window.addEventListener('touchcancel', this.onTouchCancel);
    }

    /**
     * Convert global coordinates to relative book coordinates
     *
     * @param x
     * @param y
     */
    private getMousePos(x: number, y: number): Point {
        const rect = this.distElement.getBoundingClientRect();

        return {
            x: x - rect.left,
            y: y - rect.top,
        };
    }

    private checkTarget(targer: EventTarget): boolean {
        if (!this.app.getSettings().clickEventForward) return true;

        if (['a', 'button'].includes((targer as HTMLElement).tagName.toLowerCase())) {
            return false;
        }

        return true;
    }

    // [modified] On release the direction of the last horizontal movement decides (FlipHTML5). It is kept through a
    // pause (FlipHTML5 turned the page after a 400ms stop); a movement counts from 2px on (hand jitter).
    // Measured in screen x (clientX): the book itself slides while the cover turns, so book coordinates would
    // record a finger that turns back as still going on.
    private lastDir = 0;
    private dirX = 0;

    private resetTrack(clientX: number): void {
        this.lastDir = 0;
        this.dirX = clientX;
    }

    private track(clientX: number): void {
        const dx = clientX - this.dirX;
        // dirX follows the pointer while it keeps the direction, so turning back counts from the farthest point
        if (this.lastDir !== 0 && Math.sign(dx) === this.lastDir) this.dirX = clientX;
        else if (Math.abs(dx) >= 2) {
            this.lastDir = Math.sign(dx);
            this.dirX = clientX;
        }
    }

    private onMouseDown = (e: MouseEvent): void => {
        // [modified] only the main button drags the page (a right-button drag used to turn it too)
        if (e.button !== 0) return;

        if (this.checkTarget(e.target)) {
            const pos = this.getMousePos(e.clientX, e.clientY);

            this.mouseDown = true;
            this.resetTrack(e.clientX);
            this.app.startUserTouch(pos);

            e.preventDefault();
        }
    };

    private onMouseUp = (e: MouseEvent): void => {
        const pos = this.getMousePos(e.clientX, e.clientY);

        this.mouseDown = false;
        this.track(e.clientX);
        this.app.userStop(pos, false, this.lastDir, false);
    };

    private onMouseMove = (e: MouseEvent): void => {
        // [modified] the button was released outside the window (mouseup never arrived): finish the drag
        if (this.mouseDown && e.buttons === 0) {
            this.onMouseUp(e);
            return;
        }

        const pos = this.getMousePos(e.clientX, e.clientY);

        this.track(e.clientX);
        this.app.userMove(pos, false);
    };

    /** the tracked finger among the touches of this event (other fingers are ignored) */
    private findTouch(list: TouchList): Touch | null {
        if (this.touchId === null) return null;
        for (let i = 0; i < list.length; i++) if (list[i].identifier === this.touchId) return list[i];
        return null;
    }

    // [modified] The original waited 250ms (long press) before a touch could drag the page, so a normal
    // finger drag did nothing. Now the gesture starts at once (PageFlip.userMove decides if it is a page turn).
    private onTouchStart = (e: TouchEvent): void => {
        if (!this.checkTarget(e.target) || e.changedTouches.length === 0) return;

        // a second finger while the first is still down is ignored (it used to kill the drag)
        if (this.touchId !== null && this.findTouch(e.touches) !== null) return;

        const t = e.changedTouches[0];
        const pos = this.getMousePos(t.clientX, t.clientY);

        this.touchId = t.identifier;
        this.lastTouchPos = pos;
        this.resetTrack(t.clientX);
        this.app.startUserTouch(pos);

        if (!this.app.getSettings().mobileScrollSupport) e.preventDefault();
    };

    private onTouchMove = (e: TouchEvent): void => {
        const t = this.findTouch(e.changedTouches);
        if (t === null) return;

        const pos = this.getMousePos(t.clientX, t.clientY);
        this.lastTouchPos = pos;
        this.track(t.clientX);

        if (e.cancelable) e.preventDefault();
        this.app.userMove(pos, true);
    };

    private endTouch(pos: Point, lastDir: number): void {
        // a tap on a touch screen never turns the page (only drags do)
        this.app.userStop(pos, false, lastDir, true);

        this.touchId = null;
        this.lastTouchPos = null;
    }

    private onTouchEnd = (e: TouchEvent): void => {
        const t = this.findTouch(e.changedTouches);
        if (t === null) return;

        const pos = this.getMousePos(t.clientX, t.clientY);
        this.track(t.clientX);
        this.endTouch(pos, this.lastDir);
    };

    // [modified] The system can cancel a touch (notification, gesture); without this the page stayed folded.
    // The coordinates of a cancelled touch are unreliable, so the last known position is used.
    private onTouchCancel = (e: TouchEvent): void => {
        if (this.findTouch(e.changedTouches) === null) return;

        this.endTouch(this.lastTouchPos ?? { x: 0, y: 0 }, 0);
    };
}
