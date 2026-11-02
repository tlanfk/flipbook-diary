// @ts-nocheck
import { Helper } from '../Helper';
import { Point, Rect, RectPoints, Segment } from '../BasicTypes';
import { FlipCorner, FlipDirection } from './Flip';

/**
 * Class representing mathematical methods for calculating page position (rotation angle, clip area ...)
 */
export class FlipCalculation {
    /** Calculated rotation angle to flipping page */
    private angle: number;
    /** Calculated position to flipping page */
    private position: Point;

    private rect: RectPoints;

    /** The point of intersection of the page with the borders of the book */
    private topIntersectPoint: Point = null; // With top border
    private sideIntersectPoint: Point = null; // With side border
    private bottomIntersectPoint: Point = null; // With bottom border

    private readonly pageWidth: number;
    private readonly pageHeight: number;

    /**
     * @constructor
     *
     * @param {FlipDirection} direction - Flipping direction
     * @param {FlipCorner} corner - Flipping corner
     * @param pageWidth - Current page width
     * @param pageHeight - Current page height
     */
    constructor(
        private direction: FlipDirection,
        private corner: FlipCorner,

        pageWidth: string,
        pageHeight: string
    ) {
        // [modified] parseFloat (was parseInt): the page clips must end exactly at the page elements' edges (506.8px
        // pages were clipped at 506px)
        this.pageWidth = parseFloat(pageWidth);
        this.pageHeight = parseFloat(pageHeight);
    }

    /**
     * The main calculation method
     * 
     * @param {Point} localPos - Touch Point Coordinates (relative active page!)
     * 
     * @returns {boolean} True - if the calculations were successful, false if errors occurred
     */
    public calc(localPos: Point): boolean {
        // [modified] keep the last valid geometry: a failed position used to leave half-updated values behind
        const saved = [
            this.angle,
            this.rect,
            this.position,
            this.topIntersectPoint,
            this.sideIntersectPoint,
            this.bottomIntersectPoint,
        ];

        try {
            // Find: page rotation angle and active corner position
            this.position = this.calcAngleAndPosition(localPos);
            // Find the intersection points of the scrolling page and the book
            this.calculateIntersectPoint(this.position);

            // [modified] the fold line must cross the page (the shadow is drawn along it); otherwise skip this frame
            const fold = this.getSegmentToShadowLine();
            if (fold[0] === null || fold[1] === null) throw new Error('The fold line is outside the page');

            return true;
        } catch (e) {
            [
                this.angle,
                this.rect,
                this.position,
                this.topIntersectPoint,
                this.sideIntersectPoint,
                this.bottomIntersectPoint,
            ] = saved;
            return false;
        }
    }

    /**
     * Get the crop area for the flipping page
     *
     * [modified] Exactly the folded part: the uncovered part of the page mirrored over the fold line. The original
     * polygon always began at the far corner of the turned page; when the fold crossed the side border that corner
     * only lay on the page edge, and the rounding left a 1px sliver that showed as a light line out of the book.
     *
     * @returns {Point[]} Polygon page
     */
    public getFlippingClipArea(): Point[] {
        const origin = this.getCornerOrigin();
        const length = Math.hypot(origin.x - this.position.x, origin.y - this.position.y);
        const n = { x: (origin.x - this.position.x) / length, y: (origin.y - this.position.y) / length };
        const fold = { x: (origin.x + this.position.x) / 2, y: (origin.y + this.position.y) / 2 };

        const uncovered = Helper.ClipPolygonByHalfPlane(
            [
                { x: 0, y: 0 },
                { x: this.pageWidth, y: 0 },
                { x: this.pageWidth, y: this.pageHeight },
                { x: 0, y: this.pageHeight },
            ],
            fold,
            n
        );

        return uncovered.map((p) => {
            const k = 2 * ((p.x - fold.x) * n.x + (p.y - fold.y) * n.y);
            return { x: p.x - k * n.x, y: p.y - k * n.y };
        });
    }

    /**
     * Get the crop area for the page that is below the page to be flipped
     * 
     * @returns {Point[]} Polygon page
     */
    public getBottomClipArea(): Point[] {
        const result = [];

        result.push(this.topIntersectPoint);

        if (this.corner === FlipCorner.TOP) {
            result.push({ x: this.pageWidth, y: 0 });
        } else {
            if (this.topIntersectPoint !== null) {
                result.push({ x: this.pageWidth, y: 0 });
            }
            result.push({ x: this.pageWidth, y: this.pageHeight });
        }

        if (this.sideIntersectPoint !== null) {
            if (
                Helper.GetDistanceBetweenTwoPoint(
                    this.sideIntersectPoint,
                    this.topIntersectPoint
                ) >= 10
            )
                result.push(this.sideIntersectPoint);
        } else {
            if (this.corner === FlipCorner.TOP) {
                result.push({ x: this.pageWidth, y: this.pageHeight });
            }
        }

        result.push(this.bottomIntersectPoint);
        result.push(this.topIntersectPoint);

        return result;
    }

    /**
     * Get page rotation angle
     */
    public getAngle(): number {
        if (this.direction === FlipDirection.FORWARD) {
            return -this.angle;
        }

        return this.angle;
    }

    /**
     * Get page area while flipping
     */
    public getRect(): RectPoints {
        return this.rect;
    }

    /**
     * Get the position of the active angle when turning
     */
    public getPosition(): Point {
        return this.position;
    }

    /**
     * [modified] The place of the pulled corner on the flat page. The fold line is the perpendicular bisector
     * between this point and getPosition(). x = pageWidth + 1 matches calculateAngle(), which measures from there.
     */
    public getCornerOrigin(): Point {
        return { x: this.pageWidth + 1, y: this.corner === FlipCorner.TOP ? 0 : this.pageHeight };
    }

    /**
     * Get the active corner of the page (which pull)
     */
    public getActiveCorner(): Point {
        if (this.direction === FlipDirection.FORWARD) {
            return this.rect.topLeft;
        }

        return this.rect.topRight;
    }

    /**
     * Get flipping direction
     */
    public getDirection(): FlipDirection {
        return this.direction;
    }

    /**
     * Get flipping progress (0-100)
     */
    public getFlippingProgress(): number {
        return Math.abs(((this.position.x - this.pageWidth) / (2 * this.pageWidth)) * 100);
    }
    
    /**
     * Get flipping corner position (top, bottom)
     */
    public getCorner(): FlipCorner {
        return this.corner;
    }

    /**
     * Get start position for the page that is below the page to be flipped
     */
    public getBottomPagePosition(): Point {
        if (this.direction === FlipDirection.BACK) {
            return { x: this.pageWidth, y: 0 };
        }

        return { x: 0, y: 0 };
    }

    /**
     * Get the starting position of the shadow
     */
    public getShadowStartPoint(): Point {
        if (this.corner === FlipCorner.TOP) {
            return this.topIntersectPoint;
        } else {
            if (this.sideIntersectPoint !== null) return this.sideIntersectPoint;

            return this.topIntersectPoint;
        }
    }

    /**
     * Get the rotate angle of the shadow
     */
    public getShadowAngle(): number {
        const angle = Helper.GetAngleBetweenTwoLine(this.getSegmentToShadowLine(), [
            { x: 0, y: 0 },
            { x: this.pageWidth, y: 0 },
        ]);

        if (this.direction === FlipDirection.FORWARD) {
            return angle;
        }

        return Math.PI - angle;
    }

    /**
     * [modified] The paper limit alone (nothing is drawn): x within ±page width, then the two circles. Pulled past
     * the far edge along the bottom, FlipHTML5's corner lies flat on (−W, H); without the x step it rested 13px
     * higher (W 433).
     */
    public limit(pos: Point): Point {
        const result = { x: Math.max(-this.pageWidth, Math.min(this.pageWidth, pos.x)), y: pos.y };

        if (this.corner === FlipCorner.TOP) {
            return this.checkPositionAtCenterLine(result, { x: 0, y: 0 }, { x: 0, y: this.pageHeight });
        }

        return this.checkPositionAtCenterLine(result, { x: 0, y: this.pageHeight }, { x: 0, y: 0 });
    }

    private calcAngleAndPosition(pos: Point): Point {
        const result = this.limit(pos);

        this.updateAngleAndGeometry(result);

        if (Math.abs(result.x - this.pageWidth) < 1 && Math.abs(result.y) < 1) {
            throw new Error('Point is too small');
        }

        return result;
    }

    private updateAngleAndGeometry(pos: Point): void {
        this.angle = this.calculateAngle(pos);
        this.rect = this.getPageRect(pos);
    }

    private calculateAngle(pos: Point): number {
        const left = this.pageWidth - pos.x + 1;
        const top = this.corner === FlipCorner.BOTTOM ? this.pageHeight - pos.y : pos.y;

        let angle = 2 * Math.acos(left / Math.sqrt(top * top + left * left));

        if (top < 0) angle = -angle;

        const da = Math.PI - angle;
        if (!isFinite(angle) || (da >= 0 && da < 0.003))
            throw new Error('The G point is too small');

        if (this.corner === FlipCorner.BOTTOM) angle = -angle;

        return angle;
    }


    private getPageRect(localPos: Point): RectPoints {
        if (this.corner === FlipCorner.TOP) {
            return this.getRectFromBasePoint(
                [
                    { x: 0, y: 0 },
                    { x: this.pageWidth, y: 0 },
                    { x: 0, y: this.pageHeight },
                    { x: this.pageWidth, y: this.pageHeight },
                ],
                localPos
            );
        }

        return this.getRectFromBasePoint(
            [
                { x: 0, y: -this.pageHeight },
                { x: this.pageWidth, y: -this.pageHeight },
                { x: 0, y: 0 },
                { x: this.pageWidth, y: 0 },
            ],
            localPos
        );
    }

    private getRectFromBasePoint(points: Point[], localPos: Point): RectPoints {
        return {
            topLeft: this.getRotatedPoint(points[0], localPos),
            topRight: this.getRotatedPoint(points[1], localPos),
            bottomLeft: this.getRotatedPoint(points[2], localPos),
            bottomRight: this.getRotatedPoint(points[3], localPos),
        };
    }

    private getRotatedPoint(transformedPoint: Point, startPoint: Point): Point {
        return {
            x:
                transformedPoint.x * Math.cos(this.angle) +
                transformedPoint.y * Math.sin(this.angle) +
                startPoint.x,
            y:
                transformedPoint.y * Math.cos(this.angle) -
                transformedPoint.x * Math.sin(this.angle) +
                startPoint.y,
        };
    }

    /**
     * [modified] The points where the fold line crosses the top, side and bottom border of the page.
     *
     * The folded page is the mirror image of the page across the fold line, which is the perpendicular
     * bisector between the pulled corner's original place and its current position. The original intersected
     * a moved page edge with the matching original edge; for an (almost) vertical fold those two edges are
     * almost parallel, the intersection fell outside the page and came back as null (→ crash in the shadow
     * angle). Intersecting the fold line itself gives the same points and stays stable.
     *
     * The corner sits at x = pageWidth + 1 to match calculateAngle(), which measures from there.
     */
    private calculateIntersectPoint(pos: Point): void {
        const boundRect: Rect = {
            left: -1,
            top: -1,
            width: this.pageWidth + 2,
            height: this.pageHeight + 2,
        };

        const corner = this.getCornerOrigin();
        const middle = { x: (corner.x + pos.x) / 2, y: (corner.y + pos.y) / 2 };
        const foldLine: Segment = [
            middle,
            { x: middle.x - (pos.y - corner.y), y: middle.y + (pos.x - corner.x) },
        ];

        const cross = (border: Segment): Point => {
            try {
                return Helper.GetIntersectBetweenTwoSegment(boundRect, foldLine, border);
            } catch (e) {
                return null; // the fold line lies on the border itself
            }
        };

        this.topIntersectPoint = cross([
            { x: 0, y: 0 },
            { x: this.pageWidth, y: 0 },
        ]);
        this.sideIntersectPoint = cross([
            { x: this.pageWidth, y: 0 },
            { x: this.pageWidth, y: this.pageHeight },
        ]);
        this.bottomIntersectPoint = cross([
            { x: 0, y: this.pageHeight },
            { x: this.pageWidth, y: this.pageHeight },
        ]);
    }

    /**
     * [modified] The paper does not stretch: the pulled corner stays within the diagonal of the far end of the
     * spine (centerTwo) and within the page width of the near end (centerOne). Both circles always apply, the
     * diagonal one first (as measured on FlipHTML5). The original applied the page width circle first and the
     * diagonal one only once the page had crossed the spine.
     */
    private checkPositionAtCenterLine(
        checkedPos: Point,
        centerOne: Point,
        centerTwo: Point
    ): Point {
        const rad = Math.sqrt(Math.pow(this.pageWidth, 2) + Math.pow(this.pageHeight, 2));

        const result = Helper.LimitPointToCircle(centerTwo, rad, checkedPos);

        return Helper.LimitPointToCircle(centerOne, this.pageWidth, result);
    }

    private getSegmentToShadowLine(): Segment {
        const first = this.getShadowStartPoint();

        const second =
            first !== this.sideIntersectPoint && this.sideIntersectPoint !== null
                ? this.sideIntersectPoint
                : this.bottomIntersectPoint;

        return [first, second];
    }
}
