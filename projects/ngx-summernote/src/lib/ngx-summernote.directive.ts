import { HttpClient } from '@angular/common/http';
import {
  Directive,
  ElementRef,
  EventEmitter,
  forwardRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output, SimpleChanges
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { combineLatest, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

import { SummernoteOptions } from './summernote-options';
import { codeBlockButton } from './code-block.button';

declare var Summernote: any;

@Directive({
  // tslint:disable-next-line:directive-selector
  selector: '[ngxSummernote]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => NgxSummernoteDirective),
      multi: true
    }
  ]
})
export class NgxSummernoteDirective
  implements ControlValueAccessor, OnInit, OnDestroy, OnChanges {
  @Input() set ngxSummernote(options: SummernoteOptions) {
    if (options) {
      if (!options.buttons) {
        options.buttons = {};
      }

      options.callbacks = {
        ...options.callbacks,
        onImageUpload: (files: File[]) => this.uploadImage(files),
      };

      // add custom buttons
      options.buttons.codeBlock = codeBlockButton;

      Object.assign(this._options, options);
    }
  }

  // summernoteModel directive as input: store initial editor content
  @Input() set summernoteModel(content: any) {
    this.updateEditor(content);
  }

  // summernoteModel directive as output: update model if editor contentChanged
  @Output() summernoteModelChange: EventEmitter<any> = new EventEmitter<any>();
  @Output() imageUpload: EventEmitter<any> = new EventEmitter<any>();
  @Output() mediaDelete: EventEmitter<any> = new EventEmitter<any>();

  // // summernoteInit directive as output: send manual editor initialization
  // @Output() summernoteInit: EventEmitter<Object> = new EventEmitter<Object>();

  @Output() blur: EventEmitter<any> = new EventEmitter<any>();

  @Input() ngxSummernoteDisabled: boolean = false;

  private _options: SummernoteOptions = {};

  private SPECIAL_TAGS: string[] = ['img', 'button', 'input', 'a'];
  private INNER_HTML_ATTR = 'innerHTML';
  private _hasSpecialTag: boolean = false;
  private _editorEl!: HTMLElement; // editor element
  private _model?: string;
  private _oldModel: string | null = null;
  private _editorInitialized: boolean = false;

  private uploadSub: Subscription | null = null;

  constructor(
    private el: ElementRef,
    private zone: NgZone,
    private http: HttpClient
  ) {
    const element: any = el.nativeElement;

    // check if the element is a special tag
    if (this.SPECIAL_TAGS.indexOf(element.tagName.toLowerCase()) !== -1) {
      this._hasSpecialTag = true;
    }

    this.zone = zone;
  }

  ngOnInit() {
    this.createEditor();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (this._editorInitialized && changes) {
      if (
        changes['ngxSummernoteDisabled'] &&
        !changes['ngxSummernoteDisabled'].firstChange &&
        changes['ngxSummernoteDisabled'].currentValue !==
          changes['ngxSummernoteDisabled'].previousValue
      ) {
        if (changes['ngxSummernoteDisabled'].currentValue) {
          Summernote.init(this.el.nativeElement, 'disable');
        } else {
          Summernote.init(this.el.nativeElement, 'enable');
        }
      }
    }
  }

  ngOnDestroy() {
    this.destroyEditor();
    if (this.uploadSub) {
      this.uploadSub.unsubscribe();
    }
  }

  // Begin ControlValueAccesor methods.
  onChange = (_: any) => {};
  onTouched = () => {};

  // Form model content changed.
  writeValue(content: any): void {
    this.updateEditor(content);
  }

  registerOnChange(fn: (_: any) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  // Update editor with model contents.
  private updateEditor(content: any) {
    if (JSON.stringify(this._oldModel) === JSON.stringify(content)) {
      return;
    }

    this._oldModel = content;

    if (this._editorInitialized) {
      Summernote.init(this.el.nativeElement, 'code', content);
    } else {
      this.el.nativeElement.innerHTML = content;
    }
  }

  // update model if editor contentChanged
  private updateModel(content?: any) {
    // console.log('update model', content)
    this.zone.run(() => {
      let modelContent: any = null;

      if (this._hasSpecialTag) {
        const attributeNodes = this.el.nativeElement.attributes;
        const attrs: {[attributeName: string]: string} = {};

        for (let i = 0; i < attributeNodes.length; i++) {
          const attrName = attributeNodes[i].name as string;
          if (
            this._options.angularIgnoreAttrs &&
            this._options.angularIgnoreAttrs.indexOf(attrName) !== -1
          ) {
            continue;
          }
          attrs[attrName] = attributeNodes[i].value;
        }

        if (this.el.nativeElement.innerHTML) {
          attrs[this.INNER_HTML_ATTR] = this.el.nativeElement.innerHTML;
        }

        modelContent = attrs;
      } else {
        const returnedHtml: any = content || '';
        if (typeof returnedHtml === 'string') {
          modelContent = returnedHtml;
        }
      }
      if (this._oldModel !== modelContent) {
        this._oldModel = modelContent;
        // Update summernoteModel
        this.summernoteModelChange.emit(modelContent);
        // Update form model.
        this.onChange(content);
      }
    });
  }

  private initListeners() {
    const self = this;

    if (!this.el.nativeElement) {
      return;
    }

    this.el.nativeElement.addEventListener('summernote.init', function() {
      setTimeout(function() {
        self.updateModel();
      }, 0);
    });

    ['summernote.change', 'summernote.change.codeview'].forEach(eventName => this.el.nativeElement.addEventListener(eventName, (event: any) => {
      const [contents] = event.detail;

      setTimeout(() => {
        self.updateModel(contents);
      }, 0);
    }));

    ['summernote.blur', 'summernote.blur.codeview'].forEach(eventName => this.el.nativeElement.addEventListener(eventName, () => {
      setTimeout(() => {
        self.onTouched();
        self.blur.emit();
      }, 0);
    }));

    if (this._options.immediateAngularModelUpdate) {
      this._editorEl.addEventListener('keyup', this.onEditorElKeyUp);
    }
  }

  onEditorElKeyUp = () => {
    setTimeout(() => this.updateModel(), 0);
  };

  private createEditor() {
    if (this._editorInitialized) {
      return;
    }

    this.setContent(true);

    // this.initListeners(); // issue #31

    // init editor
    this.zone.runOutsideAngular(() => {
      this._editorEl = Summernote.init(this.el.nativeElement, this._options).noteEl;

      this.initListeners(); // issue #31

      if (this.ngxSummernoteDisabled) {
        Summernote.init(this.el.nativeElement, 'disable');
      }
    });
    this._editorInitialized = true;
  }

  private setHtml() {
    Summernote.init(this.el.nativeElement, 'code', this._model || '', true);
  }

  private setContent(firstTime = false) {
    // console.log('set content', firstTime, this._oldModel, this._model)
    const self = this;
    // Set initial content
    if (this._model || this._model === '') {
      this._oldModel = this._model;
      if (this._hasSpecialTag) {
        const tags: any = this._model;
        // add tags on element
        if (tags) {
          for (const attr in tags) {
            if (tags.hasOwnProperty(attr) && attr !== this.INNER_HTML_ATTR) {
              if (tags[attr] === null) {
                this.el.nativeElement.removeAttribute(attr);
              } else if (tags[attr] !== undefined) {
                this.el.nativeElement.setAttribute(attr, tags[attr]);
              }
            }
          }

          if (tags.hasOwnProperty(this.INNER_HTML_ATTR)) {
            this.el.nativeElement.innerHTML = tags[this.INNER_HTML_ATTR];
          }
        }
      } else {
        self.setHtml();
      }
    }
  }

  private destroyEditor() {
    if (this._editorInitialized) {
      this._editorEl.removeEventListener('keyup', this.onEditorElKeyUp);
      Summernote.init(this.el.nativeElement, 'destroy'); // TODO not sure it works now...
      this._editorInitialized = false;
    }
  }

  private async uploadImage(files: File[]) {
    if (this._options.uploadImagePath) {
      this.imageUpload.emit({ uploading: true });

      const requests = [];
      for (const file of files) {
        const data = new FormData();
        data.append('image', file);
        const obs = this.http
          .post<{path?: string}>(this._options.uploadImagePath, data, this._options.uploadImageRequestOptions)
          .pipe(
            map(
              (response) => response && typeof response.path === 'string' && response.path
            )
          );
        requests.push(obs);
      }

      this.uploadSub = combineLatest(requests).subscribe(
        (remotePaths: (string | false)[]) => {
          for (const remotePath of remotePaths) {
            Summernote.init(this.el.nativeElement, 'insertImage', remotePath);
          }
          this.imageUpload.emit({ uploading: false });
        },
        err => this.insertFromDataURL(files)
      );
    } else {
      this.insertFromDataURL(files);
    }
  }

  insertFromDataURL(files: File[]) {
    for (const file of files) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        Summernote.init(this.el.nativeElement, 'insertImage', reader.result);
        this.imageUpload.emit({ uploading: false, encoding: 'base64' });
      };
      reader.onerror = error => console.error(error);
    }
  }
}
