import { render } from 'preact';
import { App } from './app';

const root = document.getElementById('formz-root');

if (!root) {
  throw new Error('Elemen #formz-root tidak ditemukan di index.html');
}

render(<App />, root);
