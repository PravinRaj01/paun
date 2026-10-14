// page-flip (StPageFlip) ships its source but no type declarations; this covers the part of the API the guide uses.
declare module "page-flip" {
  export interface PageFlipSettings {
    startPage: number;
    size: "fixed" | "stretch";
    width: number;
    height: number;
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    drawShadow: boolean;
    flippingTime: number;
    usePortrait: boolean;
    startZIndex: number;
    autoSize: boolean;
    maxShadowOpacity: number;
    showCover: boolean;
    mobileScrollSupport: boolean;
    clickEventForward: boolean;
    useMouseEvents: boolean;
    swipeDistance: number;
    showPageCorners: boolean;
    disableFlipByClick: boolean;
  }

  export type PageFlipEvent = "flip" | "init" | "update" | "changeOrientation" | "changeState";

  export class PageFlip {
    constructor(element: HTMLElement, settings: Partial<PageFlipSettings>);
    loadFromHTML(items: HTMLElement[]): void;
    on(event: PageFlipEvent, callback: (e: { data: unknown }) => void): PageFlip;
    off(event: PageFlipEvent): void;
    flipNext(corner?: "top" | "bottom"): void;
    flipPrev(corner?: "top" | "bottom"): void;
    flip(page: number, corner?: "top" | "bottom"): void;
    turnToPage(page: number): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    update(): void;
    destroy(): void;
  }
}
