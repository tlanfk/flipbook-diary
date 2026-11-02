// @ts-nocheck
import { Point, Rect, Segment } from './BasicTypes';

/**
 * A class containing helping mathematical methods
 */
export class Helper {
    /**
     * Get the distance between two points
     *
     * @param {Point} point1
     * @param {Point} point2
     */
    public static GetDistanceBetweenTwoPoint(point1: Point, point2: Point): number {
        if (point1 === null || point2 === null) {
            return Infinity;
        }

        return Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2));
    }

    /**
     * Get the length of the line segment
     *
     * @param {Segment} segment
     */
    public static GetSegmentLength(segment: Segment): number {
        return Helper.GetDistanceBetweenTwoPoint(segment[0], segment[1]);
    }

    /**
     * Get the angle between two lines
     *
     * @param {Segment} line1
     * @param {Segment} line2
     */
    public static GetAngleBetweenTwoLine(line1: Segment, line2: Segment): number {
        const A1 = line1[0].y - line1[1].y;
        const A2 = line2[0].y - line2[1].y;

        const B1 = line1[1].x - line1[0].x;
        const B2 = line2[1].x - line2[0].x;

        return Math.acos((A1 * A2 + B1 * B2) / (Math.sqrt(A1 * A1 + B1 * B1) * Math.sqrt(A2 * A2 + B2 * B2)));
    }

    /**
     * Check for a point in a rectangle
     *
     * @param {Rect} rect
     * @param {Point} pos
     *
     * @returns {Point} If the point enters the rectangle its coordinates will be returned, otherwise - null
     */
    public static PointInRect(rect: Rect, pos: Point): Point {
        if (pos === null) {
            return null;
        }

        if (
            pos.x >= rect.left &&
            pos.x <= rect.width + rect.left &&
            pos.y >= rect.top &&
            pos.y <= rect.top + rect.height
        ) {
            return pos;
        }
        return null;
    }

    /**
     * Transform point coordinates to a given angle
     *
     * @param {Point} transformedPoint - Point to rotate
     * @param {Point} startPoint - Transformation reference point
     * @param {number} angle - Rotation angle (in radians)
     *
     * @returns {Point} Point coordinates after rotation
     */
    public static GetRotatedPoint(transformedPoint: Point, startPoint: Point, angle: number): Point {
        return {
            x: transformedPoint.x * Math.cos(angle) + transformedPoint.y * Math.sin(angle) + startPoint.x,
            y: transformedPoint.y * Math.cos(angle) - transformedPoint.x * Math.sin(angle) + startPoint.y,
        };
    }

    /**
     * Limit a point "linePoint" to a given circle centered at point "startPoint" and a given radius
     *
     * @param {Point} startPoint - Circle center
     * @param {number} radius - Circle radius
     * @param {Point} limitedPoint - Сhecked point
     *
     * @returns {Point} If "linePoint" enters the circle, then its coordinates are returned.
     * Else will be returned the intersection point between the line ([startPoint, linePoint]) and the circle
     */
    public static LimitPointToCircle(startPoint: Point, radius: number, limitedPoint: Point): Point {
        const dx = limitedPoint.x - startPoint.x;
        const dy = limitedPoint.y - startPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If "linePoint" enters the circle, do nothing
        if (distance <= radius) {
            return limitedPoint;
        }

        // [modified] The intersection between the ray (startPoint → limitedPoint) and the circle, as vectors.
        // The original line formula divided by (startPoint.x − limitedPoint.x): 0/0 = NaN on the spine (x = 0).
        return {
            x: startPoint.x + (dx * radius) / distance,
            y: startPoint.y + (dy * radius) / distance,
        };
    }

    /**
     * [modified] The part of a convex polygon on the side of the line through "point" where (p − point)·normal ≥ 0
     *
     * @param {Point[]} polygon - convex polygon
     * @param {Point} point - a point of the line
     * @param {Point} normal - normal of the line, pointing to the side that is kept
     */
    public static ClipPolygonByHalfPlane(polygon: Point[], point: Point, normal: Point): Point[] {
        const result: Point[] = [];
        const side = (p: Point) => (p.x - point.x) * normal.x + (p.y - point.y) * normal.y;

        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i];
            const b = polygon[(i + 1) % polygon.length];
            const da = side(a);
            const db = side(b);

            if (da >= 0) result.push(a);
            if (da >= 0 !== db >= 0) {
                const t = da / (da - db);
                result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
            }
        }

        return result;
    }

    /**
     * Find the intersection of two lines bounded by a rectangle "rectBorder"
     *
     * @param {Rect} rectBorder
     * @param {Segment} one
     * @param {Segment} two
     *
     * @returns {Point} The intersection point, or "null" if it does not exist, or it lies outside the rectangle "rectBorder"
     */
    public static GetIntersectBetweenTwoSegment(rectBorder: Rect, one: Segment, two: Segment): Point {
        return Helper.PointInRect(rectBorder, Helper.GetIntersectBeetwenTwoLine(one, two));
    }

    /**
     * Find the intersection point of two lines
     *
     * @param one
     * @param two
     *
     * @returns {Point} The intersection point, or "null" if it does not exist
     * @throws Error if the segments are on the same line
     */
    public static GetIntersectBeetwenTwoLine(one: Segment, two: Segment): Point {
        const A1 = one[0].y - one[1].y;
        const A2 = two[0].y - two[1].y;

        const B1 = one[1].x - one[0].x;
        const B2 = two[1].x - two[0].x;

        const C1 = one[0].x * one[1].y - one[1].x * one[0].y;
        const C2 = two[0].x * two[1].y - two[1].x * two[0].y;

        const det1 = A1 * C2 - A2 * C1;
        const det2 = B1 * C2 - B2 * C1;

        const x = -((C1 * B2 - C2 * B1) / (A1 * B2 - A2 * B1));
        const y = -((A1 * C2 - A2 * C1) / (A1 * B2 - A2 * B1));

        if (isFinite(x) && isFinite(y)) {
            return { x, y };
        } else {
            if (Math.abs(det1 - det2) < 0.1) throw new Error('Segment included');
        }

        return null;
    }
}
