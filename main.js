/// First we will parse the JSON configuration file that contains the
/// high level configuration of how to layout the UI elements correctly and build the application window
/// the elements of the UI are fairly static at this point and we only need to traverse the DOM etc from that point onwards
/// let the backend know of what to execute and where
var fs = require('fs');
const path = require('path')
const { spawn } = require("child_process");
const { Client } = require('ssh2');
const dataPath =
    process.defaultApp === true
        ? path.join(__dirname)
        : path.join(process.resourcesPath);

console.log(__dirname)
console.log(process.resourcesPath)
var json = JSON.parse(fs.readFileSync(path.join(dataPath,'config_file.json'), 'utf8'));

// Modules to control application life and create native browser window
const {app, BrowserWindow, ipcMain} = require('electron')

// This is for using Embedded Java script as a templating engine to generate dynamic page based on JSON configuration
// EJS listens for template requests and renders them on the fly before servicing.
const ejse = require('ejs-electron')
ejse.data("config",json)

// Add support for remembering the location of the window and it's height and spawn there next time
const windowStateKeeper = require('electron-window-state');
let mainWindow;
function createWindow () {

  // Load the previous state with fallback to defaults
  let mainWindowState = windowStateKeeper({
    defaultWidth: 1000,
    defaultHeight: 800
  });

  // Create the browser window.
  mainWindow = new BrowserWindow({
    backgroundColor: '#2e2c29',
    'x': mainWindowState.x,
    'y': mainWindowState.y,
    'width': mainWindowState.width,
    'height': mainWindowState.height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  function transmitMessage(script_obj, pipe_type, pipe_message)
  {
    let json_object = {}
    json_object['script_obj'] = script_obj;
    json_object[pipe_type] = pipe_message
    mainWindow.webContents.send('send-command-result',json_object)
  }

  function transmitMessageWithReturnCode(script_obj, pipe_type, pipe_message, code)
  {
    let json_object = {}
    json_object['script_obj'] = script_obj;
    json_object[pipe_type] = pipe_message
    json_object['return_code'] = code
    mainWindow.webContents.send('send-command-result',json_object)
  }

  function transmitReturnCode(script_obj, code)
  {
    let json_object = {}
    json_object['script_obj'] = script_obj;
    json_object['return_code'] = code
    mainWindow.webContents.send('send-command-result',json_object)
  }

  function handleRemoteExecution(request_command)
  {
    let script_obj = request_command['script_obj']
    let transfer_success = false
    const conn = new Client();
    let localPath = path.join(dataPath, request_command["script_path"]);
    let filename = path.basename(localPath)
    let remotePath = "/tmp/" + filename

    const config = {
      host: request_command["remote_address"],
      port: 22,
      username: request_command["remote_user"],
      password : request_command["remote_password"]
    };

    conn.on('ready', () =>
    {
      conn.sftp((err,sftp) =>
      {
        if(err)
        {
            transmitMessageWithReturnCode(script_obj,'stderr',err,-1);
            return
        }
        sftp.fastPut(localPath, remotePath,{
                                                  chunkSize: 32768, // integer. Size of each read in bytes
                                                  mode: 0o755, // mixed. Integer or string representing the file mode to set
                                                },
                                            function(err)
                                                {
                                                  if (err)
                                                  {
                                                      transmitMessage(script_obj,'stderr',err);
                                                      sftp.end()
                                                  }
                                                  else
                                                  {
                                                    transmitMessage(script_obj,'stdout',"File copied to remote machine " + config.host + " at " + remotePath + " successfully")
                                                    transfer_success = true;
                                                    sftp.end()
                                                  }
                                                });

        sftp.on('end',function ()
        {
          // Close the sftp session on transfer success and now execute the function in remote
          if(transfer_success)
          {
            conn.exec(remotePath + " " + request_command["program_options"], (err, stream) =>
            {
              if (err)
              {
                transmitMessageWithReturnCode(script_obj,'stderr', err.toString("utf8"), -1);
                return;
              }
              stream.on('close', (code, signal) =>
              {
                conn.end();
                transmitReturnCode(script_obj,code);
              }).on('data', (data) =>
              {
                transmitMessage(script_obj,'stdout',data.toString("utf8"));
              }).stderr.on('data', (data) =>
              {
                transmitMessage(script_obj,'stderr',data.toString("utf8"));
              });
            });
          }
          else
          {
            transmitMessageWithReturnCode(script_obj,'stderr',"SFTP session closed ", -1);
          }
        });
      });

    });

    // Start the connection and trigger the chain reaction
    conn.on('error',function(error)
    {
      transmitMessageWithReturnCode(script_obj,'stderr', error.message,-1);
    })
    conn.connect(config);

  };

  function handleLocalExecution(request_command)
  {
    let script_obj = request_command['script_obj'];
    let scriptpath = path.join(dataPath, request_command["script_path"]);
    const ls = spawn(scriptpath + " " + request_command["program_options"], {shell: true})

    // the below is used in IPC mechanism to send result back to the renderer for updating the UI with logs and exit code etc!
    ls.stdout.setEncoding('utf8');

    ls.stdout.on("data", data => {
      transmitMessage(script_obj,'stdout', data);
    });

    ls.stderr.setEncoding('utf8');
    ls.stderr.on("data", data => {
      transmitMessage(script_obj,'stderr', data);
    });

    ls.on('error', (error) => {
      transmitMessageWithReturnCode(script_obj,'stderr', error.message,error.code);
    });

    ls.on("close", code => {
      transmitReturnCode(script_obj,code);
    });
  }



  function handleExecutionRequest (event, request_command)
  {
    if(request_command.hasOwnProperty("remote_execution") && request_command["remote_execution"])
    {
      handleRemoteExecution(request_command)
    }
    else
    {
      handleLocalExecution(request_command);
    }
  }

  ipcMain.on('execute-command',handleExecutionRequest)

  // Let the window state manage the window location so it can be updated on change etc.
  mainWindowState.manage(mainWindow);

  // and load the index.html of the app.
  mainWindow.loadURL('file://' + __dirname + '/index.ejs')

  // Open the DevTools.
  mainWindow.webContents.openDevTools()
}

console.log(json)

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
