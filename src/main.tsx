import { render } from 'preact';
import './styles/global.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);
