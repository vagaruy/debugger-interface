// Function to check if a string is numeric including whitespace check
function isNumeric(str) {
    if (typeof str != "string") return false // we only process strings!
    return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
        !isNaN(parseFloat(str)) // ...and ensure strings of whitespace fail
}

// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `preload.js` to
// selectively enable features needed in the rendering
// process.

function submita(param,obj_name,script_path)
{

    var input_fields = param.querySelectorAll('*[id^="inlineFormInput_"]');
    var program_options = ""

    for (var i = 0, len = input_fields.length; i < len; i++)
    {
        // Iterate through each input field.
        // Extract the field name from the adjacent label and then value from the input label
        // santize the input and react accordingly .
        var input_object=input_fields[i];

        var option_label=document.querySelector("label[for=" + input_object.id + "]").textContent;

        var inputType = input_object.type
        var option_val = ''
        if(inputType == 'text')
        {
             option_val = input_object.value
        }
        else if (inputType == 'file')
        {
            if (typeof input_object.files[0] !== 'undefined')
            {
                 option_val = input_object.files[0].path
            }
            else
            {
                global_store[obj_name]['term'].writeln('\x1b[1;31mFile path for Option [' + option_label + '] not provided. Program wont be executed \x1b[37m');
                return false;
            }
        }

        program_options += ' --' + option_label + ' ' + option_val
    }

    var loop_count = document.getElementById("loop_count-" + obj_name);
    var loop_delay = document.getElementById("loop_delay-" + obj_name);
    var stop_condition = document.getElementById("stop_loop_condition-" + obj_name);
    var looper_checkbox = document.getElementById("Looper-" + obj_name);
    var loop_counter = document.getElementById("loop_counter-" + obj_name);
    var remote_execution_checkbox = document.getElementById("RemoteExecution-" + obj_name);

    // some variables to store loop related information as it's cleared on last loop
    let loop_requested = false;
    let current_loop_count = 0;
    if(looper_checkbox.checked)
    {
        loop_requested = true;
        if (!isNumeric(loop_count.value))
        {
            global_store[obj_name]['term'].writeln("\x1b[1;31mLoop Count Value is not a number \x1b[37m")
            return false;
        }

        if (!isNumeric(loop_delay.value))
        {
            global_store[obj_name]['term'].writeln("\x1b[1;31mLoop Delay Value is not a number \x1b[37m")
            return false;
        }

        current_loop_count = loop_count.value;
        // Check if the loop count is 1 which means we won't be firing any more executions after this.
        // Make the Large loop counter disappear , update values etc
        if ( loop_count.value == 1 )
        {
            loop_counter.textContent = "";
            loop_count.value = "";
            loop_delay.value = "";
            looper_checkbox.disabled = false;
            looper_checkbox.checked = false;
            stop_condition.checked = false;
            remote_execution_checkbox.disabled = false;
        }
        else
        {
            let new_value = loop_count.value-1;
            loop_counter.textContent = new_value;
            looper_checkbox.disabled = true;
            loop_count.value = new_value;
            loop_count.disabled = true;
            loop_delay.disabled = true;
            stop_condition.disabled = true;
            remote_execution_checkbox.disabled = true;

            //Check if the last return code was not 0 if it exists and if the stop condition warrants us stopping any more executions
            if (global_store[obj_name].hasOwnProperty('last_return_code') )
            {
                let code = global_store[obj_name]['last_return_code'];
                if(code !== 0 && stop_condition.checked)
                {
                    global_store[obj_name]['term'].writeln("\x1b[1;31mThe stop condition triggered.No more loops to be executed \x1b[37m")
                    //todo build a function to do this instead
                    loop_counter.textContent = "";
                    loop_count.value = "";
                    loop_delay.value = "";
                    looper_checkbox.disabled = false;
                    looper_checkbox.checked = false;
                    stop_condition.checked = false;
                    remote_execution_checkbox.disabled = false;
                    return false;
                }

            }

            global_store[obj_name]['loop_timeout'] = setTimeout(submita,loop_delay.value*1000, param,obj_name,script_path)
            global_store[obj_name]['loop_timeout_not_elapsed'] = true;
        }
    }

    // build the json structure to send to the backend
    var jsonData = {};
    jsonData["script_obj"] = obj_name;
    jsonData["script_path"] = script_path;
    jsonData["program_options"] = program_options;

    // Now check if remote execution desired and append those in the json object here
    var remote_execution_checkbox = document.getElementById("RemoteExecution-" + obj_name);
    if(remote_execution_checkbox.checked)
    {
        var remote_address = document.getElementById("remote_address-" + obj_name);
        var remote_user = document.getElementById("remote_user-" + obj_name);
        var remote_password = document.getElementById("remote_password-" + obj_name);
        jsonData["remote_execution"] = true;
        jsonData["remote_address"] = remote_address.value;
        jsonData["remote_user"] = remote_user.value;
        jsonData["remote_password"] = remote_password.value;
    }

    if(global_store[obj_name]['exec_done'] != true)
    {
        global_store[obj_name]['term'].writeln("\x1b[1;31mSkipping execution [" + current_loop_count + "] as last execution isn't complete yet. \x1b[37m")
    }
    else
    {
        // Check if we expect to stop after
        document.querySelector("[id=submit_button_" + obj_name + "]").disabled = true;
        global_store[obj_name]['exec_done'] = false;

        // Add output about loop number if loop execution is happening
        if(loop_requested)
        {
            global_store[obj_name]['term'].writeln("Executing Loop [" + current_loop_count + "]")
        }
        global_store[obj_name]['term'].writeln("Executing method with program options")
        global_store[obj_name]['term'].writeln( program_options )
        window.electronAPI.executeCommand(jsonData)
    }

    return false
}

// Function that is executed after each execution is complete. It handles two things
// 1. Check if loops are remaining and if timeout is complete
// 2. If sleep has elapsed, directly trigger the next execution
// 3. If sleep hasn't elapsed, update the execute enabled button
// 4. If all loops are done, enable the Execute button again
function triggerExecutionEnabling(obj_name)
{
    global_store[obj_name]['exec_done'] = true;
    var loop_count = document.getElementById("loop_count-" + obj_name);
    if (loop_count.value === "")
    {
        document.querySelector("[id=submit_button_" + obj_name + "]").disabled = false;
    }
}

window.electronAPI.sendCommandResult((event, value) =>
{
    if(value.hasOwnProperty('stdout')){
        let message = value['stdout']
        global_store[value['script_obj']]['term'].write(message);
    }
    if(value.hasOwnProperty('stderr')){
        let message = value['stderr'] ;
        console.log("stderr: " + message)
        global_store[value['script_obj']]['term'].write("\x1b[1;31m" + message + "\x1b[37m");
    }
    if(value.hasOwnProperty('return_code')){
        let code = value['return_code']
        global_store[value['script_obj']]['last_return_code'] = code;
        if (code == 0)
        {
            global_store[value['script_obj']]['term'].writeln("\x1b[1;32mProgram ran successfully \x1b[37m");
        }
        else
        {
            global_store[value['script_obj']]['term'].writeln("\x1b[1;31mProgram failed with code " + code + "\x1b[37m")
        }
        triggerExecutionEnabling(value['script_obj']);
    }
})
