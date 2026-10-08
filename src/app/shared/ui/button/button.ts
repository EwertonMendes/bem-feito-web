import { Directive } from '@angular/core';
/** Reuses the design-system button styles on a native, accessible button. */
@Directive({selector:'button[bfButton]',host:{class:'bf-button'}})
export class BfButton {}
