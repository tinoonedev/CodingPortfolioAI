import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Workspace from './Workspace.jsx';
import './styles.css';
import './workspace.css';

const Application = window.location.pathname === '/demo' ? App : Workspace;

createRoot(document.getElementById('root')).render(<React.StrictMode><Application /></React.StrictMode>);
