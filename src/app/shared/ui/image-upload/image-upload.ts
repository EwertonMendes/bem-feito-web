import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { BfIcon } from '../icon/icon';

@Component({
  selector: 'bf-image-upload',
  imports: [BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './image-upload.html',
  styleUrl: './image-upload.scss',
})
export class BfImageUpload {
  private readonly destroyRef = inject(DestroyRef);
  private readonly nativeInput = viewChild.required<ElementRef<HTMLInputElement>>('nativeInput');

  readonly file = model<File | null>(null);
  readonly removeCurrent = model(false);

  readonly hasCurrent = input(false);
  readonly label = input('Imagem');
  readonly hint = input('PNG, JPEG, WebP, GIF ou AVIF.');
  readonly emptyTitle = input('Adicione uma imagem');
  readonly emptyDescription = input('Clique para escolher ou arraste uma imagem até aqui.');
  readonly currentTitle = input('Imagem atual');
  readonly disabled = input(false);
  readonly accept = input('image/webp,image/png,image/jpeg,image/gif,image/avif');

  readonly dragging = signal(false);
  readonly previewUrl = signal<string | null>(null);
  readonly validationMessage = signal('');

  constructor() {
    effect((onCleanup) => {
      const file = this.file();
      if (!file) {
        this.previewUrl.set(null);
        return;
      }

      const url = URL.createObjectURL(file);
      this.previewUrl.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });

    this.destroyRef.onDestroy(() => {
      const input = this.nativeInput()?.nativeElement;
      if (input) input.value = '';
    });
  }

  openPicker(): void {
    if (this.disabled()) return;
    this.validationMessage.set('');
    this.nativeInput().nativeElement.click();
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.useFile(input.files?.[0] ?? null);
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    if (this.disabled()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    if (!this.dragging()) return;
    const target = event.currentTarget;
    const next = event.relatedTarget;
    if (target instanceof Node && next instanceof Node && target.contains(next)) return;
    this.dragging.set(false);
  }

  onDrop(event: DragEvent): void {
    if (this.disabled()) return;
    event.preventDefault();
    this.dragging.set(false);
    this.useFile(event.dataTransfer?.files?.[0] ?? null);
  }

  clearSelection(): void {
    this.file.set(null);
    this.validationMessage.set('');
  }

  removeExisting(): void {
    if (!this.hasCurrent()) return;
    this.file.set(null);
    this.removeCurrent.set(true);
    this.validationMessage.set('');
  }

  restoreExisting(): void {
    if (!this.hasCurrent()) return;
    this.removeCurrent.set(false);
    this.validationMessage.set('');
  }

  fileSize(): string {
    const size = this.file()?.size ?? 0;
    if (!size) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  private useFile(file: File | null): void {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.validationMessage.set('Selecione um arquivo de imagem válido.');
      return;
    }

    this.validationMessage.set('');
    this.file.set(file);
    this.removeCurrent.set(false);
  }
}
