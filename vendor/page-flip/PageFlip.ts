// @ts-nocheck
import { PageCollection } from './Collection/PageCollection';
import { ImagePageCollection } from './Collection/ImagePageCollection';
import { HTMLPageCollection } from './Collection/HTMLPageCollection';
import { PageRect, Point } from './BasicTypes';
import { Flip, FlipCorner, FlipDirection, FlippingState } from './Flip/Flip';
import { Orientation, Render } from './Render/Render';
import { CanvasRender } from './Render/CanvasRender';
import { HTMLUI } from './UI/HTMLUI';
import { CanvasUI } from './UI/CanvasUI';
import { Helper } from './Helper';
import { Page } from './Page/Page';
import { EventObject } from './Event/EventObject';
import { HTMLRender } from './Render/HTMLRender';
import { FlipSetting, Settings } from './Settings';
import { UI } from './UI/UI';

/**
 * Class representing a main PageFlip object
 *
 * @extends EventObject
 */
export class PageFlip extends EventObject {
    private mousePosition: Point;
    private isUserTouch = false;
    /** [modified] the press moved more than 10px: a drag, not a tap */
    private isUserMove = false;
    /** [modified] the page is being pulled by the user */
    private isUserFold = false;
    /** [modified] when the press started (ms), for the speed of a flick */
    private touchTime = 0;
    /** [modified] when a drag last turned the page (ms): a flick right after it is ignored */
    private dragTurnTime = -Infinity;

    private readonly setting: FlipSetting = null;
    private readonly block: HTMLElement; // Root HTML Element

    private pages: PageCollection = null;
    private flipController: Flip;
    private render: Render;

    private ui: UI;

    /**
     * Create a new PageFlip instance
     *
     * @constructor
     * @param {HTMLElement} inBlock - Root HTML Element
     * @param {Object} setting - Configuration object
     */
    constructor(inBlock: HTMLElement, setting: Partial<FlipSetting>) {
        super();

        this.setting = new Settings().getSettings(setting);
        this.block = inBlock;
    }

    /**
     * Destructor. Remove a root HTML element and all event handlers
     */
    public destroy(): void {
        this.render.stop();
        this.ui.destroy();
        // [modified] The root element belongs to the caller (React), so it must stay in the DOM.
        // Only undo what the library added to it.
        this.block.classList.remove('stf__parent');
        this.block.style.cssText = '';
    }

    /**
     * Update the render area. Re-show current page.
     */
    public update(): void {
        this.render.update();
        this.pages.show();
    }

    /**
     * Load pages from images on the Canvas mode
     *
     * @param {string[]} imagesHref - List of paths to images
     */
    public loadFromImages(imagesHref: string[]): void {
        this.ui = new CanvasUI(this.block, this, this.setting);

        const canvas = (this.ui as CanvasUI).getCanvas();
        this.render = new CanvasRender(this, this.setting, canvas);

        this.flipController = new Flip(this.render, this);

        this.pages = new ImagePageCollection(this, this.render, imagesHref);
        this.pages.load();

        this.render.start();

        this.pages.show(this.setting.startPage);

        // safari fix
        setTimeout(() => {
            this.ui.update();
            this.trigger('init', this, {
                page: this.setting.startPage,
                mode: this.render.getOrientation(),
            });
        }, 1);
    }

    /**
     * Load pages from HTML elements on the HTML mode
     *
     * @param {(NodeListOf<HTMLElement>|HTMLElement[])} items - List of pages as HTML Element
     */
    public loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void {
        this.ui = new HTMLUI(this.block, this, this.setting, items);

        this.render = new HTMLRender(this, this.setting, this.ui.getDistElement());

        this.flipController = new Flip(this.render, this);

        this.pages = new HTMLPageCollection(this, this.render, this.ui.getDistElement(), items);
        this.pages.load();

        this.render.start();

        this.pages.show(this.setting.startPage);

        // safari fix
        setTimeout(() => {
            this.ui.update();
            this.trigger('init', this, {
                page: this.setting.startPage,
                mode: this.render.getOrientation(),
            });
        }, 1);
    }

    /**
     * Update current pages from images
     *
     * @param {string[]} imagesHref - List of paths to images
     */
    public updateFromImages(imagesHref: string[]): void {
        const current = this.pages.getCurrentPageIndex();

        this.pages.destroy();
        this.pages = new ImagePageCollection(this, this.render, imagesHref);
        this.pages.load();

        this.pages.show(current);
        this.trigger('update', this, {
            page: current,
            mode: this.render.getOrientation(),
        });
    }

    /**
     * Update current pages from HTML
     *
     * @param {(NodeListOf<HTMLElement>|HTMLElement[])} items - List of pages as HTML Element
     */
    public updateFromHtml(items: NodeListOf<HTMLElement> | HTMLElement[]): void {
        const current = this.pages.getCurrentPageIndex();

        this.pages.destroy();
        this.pages = new HTMLPageCollection(this, this.render, this.ui.getDistElement(), items);
        this.pages.load();
        (this.ui as HTMLUI).updateItems(items);
        this.render.reload();

        this.pages.show(current);
        this.trigger('update', this, {
            page: current,
            mode: this.render.getOrientation(),
        });
    }

    /**
     * Clear pages from HTML (remove to initinalState)
     */
    public clear(): void {
        this.pages.destroy();
        (this.ui as HTMLUI).clear();
    }

    /**
     * Turn to the previous page (without animation)
     */
    public turnToPrevPage(): void {
        this.pages.showPrev();
    }

    /**
     * Turn to the next page (without animation)
     */
    public turnToNextPage(): void {
        this.pages.showNext();
    }

    /**
     * Turn to the specified page number (without animation)
     *
     * @param {number} page - New page number
     */
    public turnToPage(page: number): void {
        this.pages.show(page);
    }

    /**
     * Turn to the next page (with animation)
     *
     * @param {FlipCorner} corner - Active page corner when turning
     */
    public flipNext(corner: FlipCorner = FlipCorner.BOTTOM): void {
        // [modified] by default from the bottom outer corner, like FlipHTML5 (was the top corner)
        this.flipController.flipNext(corner);
    }

    /**
     * Turn to the prev page (with animation)
     *
     * @param {FlipCorner} corner - Active page corner when turning
     */
    public flipPrev(corner: FlipCorner = FlipCorner.BOTTOM): void {
        this.flipController.flipPrev(corner);
    }

    /**
     * Turn to the specified page number (with animation)
     *
     * @param {number} page - New page number
     * @param {FlipCorner} corner - Active page corner when turning
     */
    public flip(page: number, corner: FlipCorner = FlipCorner.TOP): void {
        this.flipController.flipToPage(page, corner);
    }

    /**
     * Call a state change event trigger
     *
     * @param {FlippingState} newState - New  state of the object
     */
    public updateState(newState: FlippingState): void {
        this.trigger('changeState', this, newState);
    }

    /**
     * Call a page number change event trigger
     *
     * @param {number} newPage - New page Number
     */
    public updatePageIndex(newPage: number): void {
        this.trigger('flip', this, newPage);
    }

    /**
     * Call a page orientation change event trigger. Update UI and rendering area
     *
     * @param {Orientation} newOrientation - New page orientation (portrait, landscape)
     */
    public updateOrientation(newOrientation: Orientation): void {
        this.ui.setOrientationStyle(newOrientation);
        this.update();
        this.trigger('changeOrientation', this, newOrientation);
    }

    /**
     * Get the total number of pages in a book
     *
     * @returns {number}
     */
    public getPageCount(): number {
        return this.pages.getPageCount();
    }

    /**
     * Get the index of the current page in the page list (starts at 0)
     *
     * @returns {number}
     */
    public getCurrentPageIndex(): number {
        return this.pages.getCurrentPageIndex();
    }

    /**
     * Get page from collection by number
     *
     * @param {number} pageIndex
     * @returns {Page}
     */
    public getPage(pageIndex: number): Page {
        return this.pages.getPage(pageIndex);
    }

    /**
     * Get the current rendering object
     *
     * @returns {Render}
     */
    public getRender(): Render {
        return this.render;
    }

    /**
     * Get current object responsible for flipping
     *
     * @returns {Flip}
     */
    public getFlipController(): Flip {
        return this.flipController;
    }

    /**
     * Get current page orientation
     *
     * @returns {Orientation} Сurrent orientation: portrait or landscape
     */
    public getOrientation(): Orientation {
        return this.render.getOrientation();
    }

    /**
     * Get current book sizes and position
     *
     * @returns {PageRect}
     */
    public getBoundsRect(): PageRect {
        return this.render.getRect();
    }

    /**
     * Get configuration object
     *
     * @returns {FlipSetting}
     */
    public getSettings(): FlipSetting {
        return this.setting;
    }

    /**
     * Get UI object
     *
     * @returns {UI}
     */
    public getUI(): UI {
        return this.ui;
    }

    /**
     * Get current flipping state
     *
     * @returns {FlippingState}
     */
    public getState(): FlippingState {
        return this.flipController.getState();
    }

    /**
     * Get page collection
     *
     * @returns {PageCollection}
     */
    public getPageCollection(): PageCollection {
        return this.pages;
    }

    /**
     * Start page turning. Called when a user clicks or touches
     *
     * @param {Point} pos - Touch position in coordinates relative to the book
     */
    public startUserTouch(pos: Point): void {
        this.mousePosition = pos; // Save touch position
        this.isUserTouch = true;
        this.isUserMove = false;
        this.isUserFold = false;
        this.touchTime = performance.now();
    }

    /**
     * Called when a finger / mouse moves
     *
     * @param {Point} pos - Touch position in coordinates relative to the book
     * @param {boolean} isTouch - True if there was a touch event, not a mouse click
     */
    public userMove(pos: Point, isTouch: boolean): void {
        if (!this.isUserTouch && !isTouch && this.setting.showPageCorners) {
            this.flipController.showCorner(pos); // fold Page Corner
        } else if (this.isUserTouch) {
            if (!this.isUserFold) {
                // [modified] a press becomes a drag after 10px (FlipHTML5)
                if (!this.isUserMove) {
                    if (Helper.GetDistanceBetweenTwoPoint(this.mousePosition, pos) <= 10) return;
                    this.isUserMove = true;
                }

                if (!this.startFold(pos)) return;
                this.isUserFold = true;
            }

            this.flipController.fold(pos);
        }
    }

    /**
     * [modified] When the page starts to curl (as measured on FlipHTML5):
     * - pressed in a corner area → at once, and the corner follows the finger;
     * - anywhere else → once the finger has moved more than 30px sideways in a turning direction (no angle rule,
     *   the vertical movement does not matter). The page is then held at its outer edge at the finger's height.
     *
     * @returns true if the page started to curl
     */
    private startFold(pos: Point): boolean {
        const start = this.mousePosition;
        if (this.flipController.isPointOnCorners(start)) return this.flipController.startFold(start, null, true);

        const rect = this.render.getRect();
        const dx = pos.x - start.x;
        let direction: FlipDirection;

        if (this.render.getOrientation() === Orientation.PORTRAIT) {
            // one page: to the left = next, to the right = previous
            if (dx < -30) direction = FlipDirection.FORWARD;
            else if (dx > 30) direction = FlipDirection.BACK;
            else return false;
        } else {
            // two pages: the grabbed page turns toward the spine
            direction = start.x - rect.left < rect.width / 2 ? FlipDirection.BACK : FlipDirection.FORWARD;
            if (direction === FlipDirection.FORWARD ? dx >= -30 : dx <= 30) return false;
        }

        return this.flipController.startFold(pos, direction, false, start);
    }

    /**
     * Сalled when the user has stopped touching
     *
     * @param {Point} pos - Touch end position in coordinates relative to the book
     * @param {boolean} isSwipe - true if there was a mobile swipe event
     * @param {number} lastDir - [modified] direction of the last horizontal pointer movement (−1 left, 1 right, 0 none)
     * @param {boolean} isTouch - [modified] released by a touch. A tap never turns the page, a click on a corner does.
     */
    public userStop(pos: Point, isSwipe = false, lastDir = 0, isTouch = false): void {
        if (this.isUserTouch) {
            this.isUserTouch = false;

            if (!isSwipe) {
                if (this.isUserFold) {
                    if (this.flipController.stopMove(pos, lastDir, isTouch)) this.dragTurnTime = performance.now();
                } else if (this.isUserMove) {
                    this.flick(pos);
                } else if (!isTouch) {
                    this.flipController.flip(pos);
                }
            }
        }
    }

    /**
     * [modified] A short swipe that did not curl the page (FlipHTML5 swipe): mostly sideways and faster than
     * 0.03px/ms over the whole gesture → the page turns by itself. Ignored within 500ms after a drag turned a page.
     */
    private flick(pos: Point): void {
        const now = performance.now();
        const dx = pos.x - this.mousePosition.x;
        const dy = pos.y - this.mousePosition.y;

        if (Math.abs(dx) <= Math.abs(dy) || now - this.dragTurnTime < 500) return;
        if (Math.abs(dx) / Math.max(1, now - this.touchTime) <= 0.03) return;

        if (dx < 0) this.flipController.flipNext(FlipCorner.BOTTOM);
        else this.flipController.flipPrev(FlipCorner.BOTTOM);
    }
}
